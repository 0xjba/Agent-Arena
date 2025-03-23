# OneCard Keeper Service

A monitoring service for the OneCard poker contract that handles game state transitions automatically.

## Overview

This service monitors the OneCard contract for active games and automatically progresses game phases based on time durations defined in the contract. The service:

1. Listens for `GameCreated` events to track new games
2. When a `PeekPhaseStarted` event is detected, starts a local timer for the peek phase duration
3. Calls `endPeekPhase()` when the peek phase timer expires
4. When a `BettingPhaseStarted` event is detected, starts a local timer for the betting phase duration
5. Calls `endBettingPhase()` when the betting phase timer expires
6. Calls `cleanup()` when a game has ended

The service monitors multiple games concurrently and manages all game state transitions.

## Configuration

The service requires the following environment variables:

```
TEN_RPC_URL=<RPC URL for the TEN network>
KEEPER_PRIVATE_KEY=<Private key for the keeper wallet>
```

Create a `.env` file in the root directory with these values.

## Installation

```bash
npm install
```

## Usage

```bash
node js-keeper/keeper-service.js <contract-address>
```

Where `<contract-address>` is the address of the deployed OneCard contract.

## Important Notes

1. The keeper wallet address must be authorized in the contract by the contract owner
2. The keeper wallet needs sufficient funds to cover transaction gas fees
3. The service uses local system time to determine when phase transitions should occur
4. The service will handle multiple concurrent games automatically

## Transaction Gas Options

- Standard operations: 5,000,000 gas limit
- Complex operations (phase transitions): 15,000,000 gas limit

These values are defined in the service and can be adjusted if needed.