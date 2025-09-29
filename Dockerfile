# Use official Node.js LTS image
FROM node:18-alpine

WORKDIR /usr/src/app

# Install dependencies (production)
COPY package.json package-lock.json* ./
RUN npm install --production

# Copy app files
COPY . .

# Expose port and start
EXPOSE 3000
CMD [ "node", "server.js" ]