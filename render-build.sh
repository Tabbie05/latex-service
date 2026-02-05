#!/usr/bin/env bash

echo "Installing LaTeX on Render server..."

apt-get update

apt-get install -y \
  texlive-latex-base \
  texlive-latex-recommended \
  texlive-latex-extra \
  texlive-fonts-recommended \
  texlive-fonts-extra \
  texlive-xetex

echo "LaTeX installation finished!"
