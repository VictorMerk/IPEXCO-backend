FROM ubuntu:noble
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 python3-pip curl ca-certificates && \
    python3 -m pip install --break-system-packages setuptools unified-planning && \
    rm -rf /var/lib/apt/lists/*

# demo builder and plan-property plan checker
COPY utils/ /usr/src/utils

# Install the Node.js major version used by the project.
RUN curl -sL https://deb.nodesource.com/setup_22.x | bash -
RUN apt-get update && apt-get install -y --no-install-recommends nodejs && rm -rf /var/lib/apt/lists/*

#copy app bin
RUN mkdir -p /usr/src/app
WORKDIR /usr/src/app
COPY package.json package-lock.json ./
RUN npm ci --include=dev
COPY . /usr/src/app
RUN npm run build

# persistent storage
RUN mkdir -p  /usr/src/app/dist/out-tsc/data
VOLUME /usr/src/app/dist/out-tsc/data

# environment
ENV UPLOADPATH=/usr/src/app/dist/out-tsc/data/uploads
ENV PDDLPARSER=/usr/src/utils/pddl_parser/

# run
EXPOSE 3000

WORKDIR /usr/src/app
CMD ["node", "dist/out-tsc/app.js"]
