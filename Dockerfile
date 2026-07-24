# Use an official lightweight Node.js runtime as the base image
FROM node:20-slim

# Set a working directory inside the container
WORKDIR /app

# Copy dependency manifests first to leverage Docker layer caching
COPY package.json package-lock.json* ./

# Install dependencies
RUN npm ci --omit=dev

# Copy the application source code
COPY . .

# Expose the port the app runs on
EXPOSE 4000

# Run the application
CMD ["node", "src/server.js"]
