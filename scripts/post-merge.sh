#!/bin/bash
set -e

cd "Betrayal Game"
npm install --prefer-offline

cd client
npm install --prefer-offline
npm run build
