import serverless from 'serverless-http';
import { app } from './app';

/** API Gateway -> Lambda entry point. Lambda handler setting: dist/lambda.handler */
export const handler = serverless(app);
