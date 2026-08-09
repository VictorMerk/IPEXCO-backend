# IPEXCO - Iterative Planning Tool with Explanations of Conflicts - BACK END

## Docker Image

Unless you want to change the backend service, we suggest running it in a
Docker container.
We provide a pre-built Docker image on DockerHub: `eifler/ipexco-backend`

If you want to build your own Docker image, run:

```
docker build -t ipexco-backend .
```

## Setup

**Note** Make sure that the submodule **utils** is initialized and updated!

### Dependencies

The dependencies are:

- `npm` (https://www.npmjs.com/)
- `node.js` version 22 (https://nodejs.org/en)


Before the first run, install the locked npm dependencies with:

```
npm ci
```

## Environment

The back-end requires the following environment variables to run:

- `PORT` the port the web server should be listening on (default `3000`)
- `BASE_URL` the URL the backend is reachable on. It is used to compose the 
    callback URL for the services. `http://localhost:3000` should work for a
    local setup. On MacOS there might be some changes necessary since the network
    sharing between the host and docker containers is different from Linux.
- `MONGO` the URL of the mongoDB database. In a local setup 
    `mongodb://localhost:27017/ipexco` should work.
- `JWT_KEY`: a random string that is used to generate the login tokens to authenticate 
    users
- `SERVICE_KEY`: a random string that is used to authenticate any registered 
    services, e.g. planner 
- `PDDLPARSER=utils/pddl_parser/` the path to the PDDL parser contained in the
    `utils` submodule
- `UPLOADPATH` a path to a local folder where uploaded images can be stored

Optional environment variables:

- `ALLOW_REGISTRATION` set to `true` allows new users to register (default `false`)
- `ALLOW_USER_STUDY_USERS` set to `true` allows users to participate in a user study
- `CORS_ORIGIN` comma-separated browser origins allowed to call the API
  (default `http://localhost:4200`)
- `PLANPILOT_REQUEST_TIMEOUT_MS` deadline for PlanPilot service calls in
  milliseconds (default `345000`)
- `OPENAI_API_KEY`: the API key for the OpenAI service. It is mandatory to set this variable with your own valid key if you want to use the LLM interfaces. These keys are generated from the Open AI Platform (https://platform.openai.com/api-keys).


### Run

```
npm start
```

### PlanPilot checks

The focused back-end checks build the project and test the PlanPilot client,
run identity, project ownership filters and service selection:

```bash
npm run test:planpilot
```

## Platform Usage

For instructions on how to use the platform we refer to the
[README](https://github.com/VictorMerk/IPEXCO-frontend/blob/dev/README.md) of the
front-end repository.
