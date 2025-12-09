#!/bin/bash

NETWORK=$1
CONTRACT_TYPE=$2

if [ -z "$NETWORK" ] || [ -z "$CONTRACT_TYPE" ]; then
    echo "Usage: ./deploy.sh <network> <contract_type>"
    echo "Networks: ethereum, polygon, avalanche, base"
    echo "Contracts: treasury, private-credit, real-estate"
    exit 1
fi

echo "Deploying $CONTRACT_TYPE to $NETWORK..."

cd ../../contracts
npx hardhat run scripts/deploy-${CONTRACT_TYPE}.js --network ${NETWORK}
