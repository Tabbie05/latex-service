FROM node:18-slim

# Install LaTeX
RUN apt-get update && \
    apt-get install -y \
    texlive-latex-base \
    texlive-latex-extra \
    texlive-fonts-recommended \
    texlive-fonts-extra \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package.json and install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy rest of the files
COPY . .

# Expose port
EXPOSE 3001

# Start the service
CMD ["npm", "start"]
