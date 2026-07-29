import { UserModel, User } from './../db_schema/user';
import * as jwt from 'jsonwebtoken';
import { Response, Request, NextFunction } from 'express';
import { environment } from '../app';
import { Document } from 'mongoose';

const errorMessage = 'Not authorized to access this resource';

export interface AuthenticatedRequest extends Request{
    user?: User & Document,
    token?: string
}

// declare global {
//     namespace Express {
//         interface Request {
//             user?: User,
//             token?: string
//         }
//     }
// }

export const authAny = async(req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        if (! req.header('Authorization')) {
            res.status(401).send({ error: errorMessage });
            return;
        }

        const token: string | undefined = req.header('Authorization')?.replace('Bearer ', '');
        if (token === undefined) {
            res.status(401).send({ error: errorMessage });
            return;
        }
        const data: User = jwt.verify(token, environment.jwtKey) as User;
        const user = await UserModel.findOne({ _id: data._id, 'tokens.token': token });
        if (!user) {
            res.status(401).send({ error: errorMessage });
            return;
        }
        req.user = user;
        req.token = token;
        next();
    } catch (error) {
        res.status(401).send({ error: errorMessage });
    }

};


export const auth = async(req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        if (! req.header('Authorization')) {
            res.status(401).send({ error: errorMessage });
            return;
        }

        const token: string | undefined = req.header('Authorization')?.replace('Bearer ', '');
        if (token === undefined) {
            res.status(401).send({ error: errorMessage });
            return;
        }
        const data: User = jwt.verify(token, environment.jwtKey) as User;
        const user = await UserModel.findOne({ _id: data._id, 'tokens.token': token });
        if (!user) {
            res.status(401).send({ error: errorMessage });
            return;
        }
        if (user.role != 'admin' && user.role != 'creator') {
            res.status(403).send({ error: errorMessage });
            return;
        }
        req.user = user;
        req.token = token;
        next();
    } catch (error) {
        res.status(401).send({ error: errorMessage });
    }

};


export const authAdmin = async(req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        if (! req.header('Authorization')) {
            res.status(401).send({ error: errorMessage });
            return;
        }

        const token: string | undefined = req.header('Authorization')?.replace('Bearer ', '');
        if (token === undefined) {
            res.status(401).send({ error: errorMessage });
            return;
        }
        const data: User = jwt.verify(token, environment.jwtKey) as User;
        const user = await UserModel.findOne({ _id: data._id, 'tokens.token': token });
        if (!user) {
            res.status(401).send({ error: errorMessage });
            return;
        }
        if (user.role != 'admin') {
            res.status(403).send({ error: errorMessage });
            return;
        }
        req.user = user;
        req.token = token;
        next();
    } catch (error) {
        res.status(401).send({ error: errorMessage });
    }

};


export const authForward = async(req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        if (! req.header('Authorization')) {
            next();
            return;
        }

        const token: string | undefined = req.header('Authorization')?.replace('Bearer ', '');
        if (token === undefined) {
            res.status(401).send({ error: errorMessage });
            return;
        }
        const data: User = jwt.verify(token, environment.jwtKey) as User;
        const user = await UserModel.findOne({ _id: data._id, 'tokens.token': token });
        if (!user) {
            next();
            return;
        }
        req.user = user;
        req.token = token;
        next();
    } catch (error) {
        next();
    }

};


export const authService = async(req: Request, res: Response, next: NextFunction) => {

    try {
        if (! req.header('Authorization')) {
            res.status(401).send({ error: errorMessage });
            return;
        }

        const token: string | undefined = req.header('Authorization')?.replace('Bearer ', '');
        if (token === undefined) {
            res.status(401).send({ error: errorMessage });
            return;
        }
        
        if(token != environment.serviceKey){
            res.status(401).send({ error: errorMessage });
            return;
        }

        next();

    } catch (error) {
        res.status(401).send({ error: errorMessage });
    }

};
