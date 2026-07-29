import express from 'express';

import { Service, ServiceBaseZ, ServiceModel } from '../db_schema/services';
import { auth, authAny } from '../middleware/auth';

export const serviceRouter = express.Router();


serviceRouter.post('', auth, async (req, res) => {
    try {
        const serviceData = ServiceBaseZ.parse(req.body);

        const service = new ServiceModel(serviceData);
        if (!service) {
            res.status(500).send('service not created');
            return;
        }
        const newService = await service.save();

        res.send(newService);
    }
    catch (ex : any) {
        console.log(ex.message);
        res.status(500).send();
    }
});


serviceRouter.put('/:id', auth, async (req, res) => {
    try {
        const refId = req.params.id;

        const serviceData = ServiceBaseZ.parse(req.body);

        await ServiceModel.replaceOne({ _id: refId}, serviceData);

        const service: Service | null = await ServiceModel.findOne({ _id: refId}).lean();

        if (!service) {
            res.status(403).send('update service failed');
            return;
        }

        res.send(service);

    } catch (ex : any) {
        console.log(ex.message);
        res.status(500).send();
    }
});


serviceRouter.get('', authAny, async (req, res) => {
    try {

        const services = await ServiceModel.find();

        if (!services) { 
            res.status(404).send({ message: 'No service found.' });
            return;
        }

        res.send(services);

    } catch (ex : any) {
        console.log(ex.message);
        res.status(500).send();
    }

});


serviceRouter.delete('/:id', auth, async (req, res) => {

    try{
        const result = await ServiceModel.deleteOne({ _id: req.params.id});

        if (result.deletedCount !== 1) { 
            res.status(404).send({ message: 'No service found.' });
            return;
        }

        res.send(true);

    } catch (ex : any) {
        console.log(ex.message);
        res.status(500).send();
    }
});


