FROM node:18-slim

# Install LaTeX + FontAwesome TTFs (needed by xelatex for fontawesome5 package).
# fonts-font-awesome provides the actual TTF glyph files; without them
# xelatex stalls trying to resolve icons like \faExternalLinkAlt.
# fc-cache rebuilds the fontconfig cache so xelatex can find the new fonts.
RUN apt-get update && apt-get install -y \
  texlive-latex-base \
  texlive-latex-recommended \
  texlive-latex-extra \
  texlive-fonts-recommended \
  texlive-fonts-extra \
  texlive-xetex \
  texlive-lang-english \
  latexmk \
  fonts-font-awesome \
  fontconfig \
  && fc-cache -fv \
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
