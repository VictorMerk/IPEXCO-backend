
import express from 'express';
import { environment } from '../app';
import { auth } from '../middleware/auth';
import { PDDLParser } from '../services/pddl/pddl_parser';

export const pddlRouter = express.Router();


pddlRouter.post('/model', auth,  async (req, res) => {
    let parser: PDDLParser | undefined;
    try {
        console.log("Parse pddl model ...")
        let problemText = req.body.data.problem
        let domainText = req.body.data.domain
       

        parser = new PDDLParser(environment.experimentsRootPath, Date.now().toString(), domainText, problemText)
        const model = await parser.parse()

        console.log('PDDL model parsed')

        //TODO metrics

        res.status(200).send({data: model})

    } catch (error) {
        console.log(error);
        res.status(500).send();
    } finally {
        parser?.tidyUp();
    }
});
