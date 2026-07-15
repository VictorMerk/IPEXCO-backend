import { auth } from './middleware/auth';
import { userRouter } from './routes/user';
import createError from 'http-errors';
import express from 'express';
import path from 'path';
import fs from 'fs';
import cookieParser from 'cookie-parser';

import logger from 'morgan';

import errorMiddleware from './middleware/error.middleware';

import { projectRouter } from './routes/project';
import { indexRouter } from './routes';
import { planPropertyRouter } from './routes/plan_property';
import { iterationStepRouter } from './routes/iteration-step';
import { demoRouter } from './routes/demo';
import { userStudyRouter } from './routes/user-study/user-study';
import { Environment } from './environment';

import * as dotenv from "dotenv";
import { participantDistributerRouter } from './routes/user-study/participant-distributer';
import { userStudyExecutionRouter } from './routes/user-study/user-study-execution';
import { plannerRouter } from './routes/planner';
import { pddlRouter } from './routes/pddl';
import { LLMRouter } from './routes/llm-connector';

import { explainerRouter } from './routes/explainer';
import { domainSpecificationRouter } from './routes/domain_specification';
import { promptRouter } from './routes/prompt';
import { serviceRouter } from './routes/services';
import { planRouter } from './routes/plan';
import { planPilotRouter } from './routes/planpilot';



dotenv.config();

console.log('-------- IPEXCO BACK END ---------');

const results_folder = path.join(__dirname, 'data/results');
const uploads_folder = path.join(__dirname, 'data/uploads');
const images_folder = path.join(__dirname, 'data/images')


// create folders if not already exist
console.log('---> statically served path');

// console.log(uploads_folder);
// if(! fs.existsSync(uploads_folder)){
//   fs.mkdirSync(uploads_folder)
//   console.log(uploads_folder + " created");
// }

// console.log(results_folder);
// if(! fs.existsSync(results_folder)){
//   fs.mkdirSync(results_folder)
//   console.log(results_folder + " created");
// }

// console.log(images_folder);
// if(! fs.existsSync(images_folder)){
//   fs.mkdirSync(images_folder)
//   console.log(images_folder + " created");
// }

export const environment = new Environment();
// console.log(environment)

if (!environment.jwtKey) {
  throw new Error('JWT_KEY must be configured before starting IPEXCO backend.');
}

const app = express();
const cors = require('cors');
const mongoose = require('mongoose');

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'pug');

const corsOrigins = (process.env.CORS_ORIGIN || 'http://localhost:4200')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
app.use(cors({ origin: corsOrigins }));
app.use(logger('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false, limit: '10mb' }));
app.use(cookieParser());

app.use(express.static(path.join(__dirname, 'public')));

// app.use(auth);
app.use('/', indexRouter);
app.get('/api/health', (_req, res) => res.status(200).send({ status: 'ok' }));

app.use('/api/pddl', pddlRouter);

app.use('/api/users', userRouter);

app.use('/api/domain-spec', domainSpecificationRouter);
app.use('/api/llm-spec', promptRouter);
app.use('/api/services', serviceRouter);

app.use('/api/user-study-participant-distribution', participantDistributerRouter);
app.use('/api/user-study', userStudyRouter);
app.use('/api/user-study-execution', userStudyExecutionRouter);

app.use('/api/demo', demoRouter);
app.use('/api/iteration-step', iterationStepRouter);
app.use('/api/plan', planRouter);
app.use('/api/planpilot', planPilotRouter);

app.use('/api/plan-property', planPropertyRouter);

app.use('/uploads', express.static(uploads_folder));
app.use('/results', express.static(results_folder));
app.use('/images', express.static(images_folder));

app.use('/api/planner', plannerRouter);
app.use('/api/explainer', explainerRouter);
app.use('/api/run', iterationStepRouter);

app.use('/api/project', projectRouter);

app.use('/api/llm', LLMRouter);

// catch 404 and forward to error handler
app.all('*', (req, res, next) => {
  next(createError('404'));
});

// error handler
app.use(errorMiddleware);


// Data base connection
const port = environment.port || 3000;
const mongodbURL = process.env.MONGO || 'mongodb://localhost/ipexco';
mongoose.connect(mongodbURL)
    .then(() => {
      console.log('connected to DB');
      // mongoose.connection.db.dropDatabase();

    })
    .catch((err: { message: any; }) => console.log(`something went wrong ${err.message}`));


app.listen(port , () => console.log(`Backend server port working on ${port}`));

module.exports = app;
