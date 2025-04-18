/**
 * Keeper Service for OneCard Contract
 * 
 * This service monitors the OneCard contract for game state changes and
 * automatically triggers phase transitions based on the contract's timers.
 */

require('dotenv').config();
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

// Constants
const POLLING_INTERVAL = 5000; // 5 seconds - Frequent polling for active games
const GAME_DISCOVERY_INTERVAL = 10000; // 10 seconds - Separate interval for discovering new games
const DEBUG = true;

// Environment variables
const RPC_URL = process.env.TEN_RPC_URL || 'http://127.0.0.1:8545';
const PRIVATE_KEY = process.env.KEEPER_PRIVATE_KEY;

if (!PRIVATE_KEY) {
  console.error('Error: KEEPER_PRIVATE_KEY not found in environment variables');
  process.exit(1);
}

// Gas options for transactions
const highGasTxOptions = {
  gasLimit: 5000000
};

const veryHighGasTxOptions = {
  gasLimit: 15000000
};

// Load OneCard contract ABI
const contractPath = path.join(__dirname, '..', 'artifacts', 'contracts', 'vanilla', 'OneCard.sol', 'OneCard.json');
const contractJson = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
const contractABI = contractJson.abi;

// Game state enum mapping (must match contract)
const GameState = {
  PRE_GAME: 0,
  PEEK_PHASE: 1,
  BETTING: 2,
  SHOWDOWN: 3,
  ENDED: 4
};

// Setup provider and signer
const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
const signer = new ethers.Wallet(PRIVATE_KEY, provider);

// Contract instance
let oneCardContract;

// Store active games with their timestamps
const activeGames = new Map();

/**
 * Initialize the keeper service
 * @param {string} contractAddress - The address of the OneCard contract
 */
async function initializeKeeper(contractAddress) {
  if (!contractAddress) {
    console.error('Error: Contract address required');
    process.exit(1);
  }

  oneCardContract = new ethers.Contract(contractAddress, contractABI, signer);
  
  // Make sure the keeper is authorized
  const isKeeper = await oneCardContract.isKeeper(signer.address);
  if (!isKeeper) {
    console.error('Error: This wallet is not authorized as a keeper');
    console.log('Please add this address as a keeper:', signer.address);
    process.exit(1);
  }

  console.log('Keeper service initialized');
  console.log('Contract address:', contractAddress);
  console.log('Keeper address:', signer.address);
  
  // Start listening for events
  setupEventListeners();
  
  // Start monitoring active games with frequent polling
  setInterval(monitorActiveGames, POLLING_INTERVAL);
  
  // Start discovery process to find any missed games
  setInterval(discoverNewGames, GAME_DISCOVERY_INTERVAL);
}

/**
 * Setup event listeners for the contract
 */
function setupEventListeners() {
  // Listen for GameCreated events
  oneCardContract.on('GameCreated', async (gameId, keeper, creator, event) => {
    console.log(`New game created: ${gameId.toString()}`);
    
    // Add to a pending games list - we'll start monitoring it right away
    // even though it's still in PRE_GAME state
    console.log(`Starting to monitor game ${gameId.toString()} in PRE_GAME state`);
    activeGames.set(gameId.toString(), {
      state: GameState.PRE_GAME,
      createdAt: Date.now()
    });
  });

  // Listen for PeekPhaseStarted events
  oneCardContract.on('PeekPhaseStarted', async (gameId, event) => {
    console.log(`Peek phase started for game: ${gameId.toString()}`);
    
    // Get the current contract time and add to tracked games
    const gameInfo = await oneCardContract.getGameInfo(gameId);
    const localTimestamp = Date.now();
    const phaseEndTime = gameInfo.phaseEndTime.toNumber() * 1000; // Convert from seconds to milliseconds
    
    activeGames.set(gameId.toString(), {
      state: GameState.PEEK_PHASE,
      phaseEndTime: phaseEndTime,
      localEndTime: localTimestamp + (gameInfo.remainingTime.toNumber() * 1000)
    });
    
    logDebug(`Game ${gameId} peek phase ends at: ${new Date(phaseEndTime).toISOString()}`);
    logDebug(`Local time will be: ${new Date(localTimestamp + (gameInfo.remainingTime.toNumber() * 1000)).toISOString()}`);
  });

  // Listen for BettingPhaseStarted events
  oneCardContract.on('BettingPhaseStarted', async (gameId, event) => {
    console.log(`Betting phase started for game: ${gameId.toString()}`);
    
    // Update the game state and timer
    const gameInfo = await oneCardContract.getGameInfo(gameId);
    const localTimestamp = Date.now();
    const phaseEndTime = gameInfo.phaseEndTime.toNumber() * 1000; // Convert from seconds to milliseconds
    
    activeGames.set(gameId.toString(), {
      state: GameState.BETTING,
      phaseEndTime: phaseEndTime,
      localEndTime: localTimestamp + (gameInfo.remainingTime.toNumber() * 1000)
    });
    
    logDebug(`Game ${gameId} betting phase ends at: ${new Date(phaseEndTime).toISOString()}`);
    logDebug(`Local time will be: ${new Date(localTimestamp + (gameInfo.remainingTime.toNumber() * 1000)).toISOString()}`);
  });

  // Listen for GameEnded events
  oneCardContract.on('GameEnded', (gameId, winner, potAmount, event) => {
    console.log(`Game ${gameId.toString()} ended. Winner: ${winner}. Pot: ${ethers.utils.formatUnits(potAmount, 'wei')}`);
    
    if (activeGames.has(gameId.toString())) {
      // Update state to ENDED so we can clean it up
      const gameData = activeGames.get(gameId.toString());
      gameData.state = GameState.ENDED;
      activeGames.set(gameId.toString(), gameData);
    }
  });
}

/**
 * Discover any new games that may have been created that we missed the events for
 */
async function discoverNewGames() {
  try {
    // Get the current game ID from the contract
    const currentGameId = await oneCardContract.currentGameId();
    
    // Log the current max game ID
    logDebug(`Current max game ID from contract: ${currentGameId}`);
    
    // Check for games we're not tracking
    for (let i = 1; i <= currentGameId; i++) {
      const gameId = i.toString();
      
      // Skip games we're already tracking
      if (activeGames.has(gameId)) {
        continue;
      }
      
      try {
        // Try to get game info - will fail if game doesn't exist
        const gameInfo = await oneCardContract.getGameInfo(gameId);
        
        // If we get here, the game exists and we're not tracking it
        console.log(`Discovered missed game ${gameId} in state ${GameState[gameInfo.state]}`);
        
        // If the game is not ended and not cleaned up, add it to our tracking
        if (gameInfo.state !== GameState.ENDED && !gameInfo.isCleanedUp) {
          // Add the game to our tracking with the appropriate state
          if (gameInfo.state === GameState.PEEK_PHASE || gameInfo.state === GameState.BETTING) {
            // For timed phases, set up local timers correctly
            const localTimestamp = Date.now();
            const remainingTime = gameInfo.remainingTime.toNumber() * 1000; // Convert to milliseconds
            
            activeGames.set(gameId, {
              state: gameInfo.state,
              localEndTime: localTimestamp + remainingTime
            });
            
            console.log(`Started tracking game ${gameId} in ${GameState[gameInfo.state]} state, ending in ${Math.floor(remainingTime/1000)} seconds`);
          } else {
            // For other states (PRE_GAME), just track the state
            activeGames.set(gameId, {
              state: gameInfo.state,
              createdAt: Date.now()
            });
            
            console.log(`Started tracking game ${gameId} in ${GameState[gameInfo.state]} state`);
          }
        }
      } catch (error) {
        // This can happen if the game doesn't exist
        if (!error.message.includes("Game not found")) {
          console.error(`Error checking game ${gameId}:`, error.message);
        }
      }
    }
  } catch (error) {
    console.error("Error discovering new games:", error.message);
  }
}

/**
 * Monitor active games and trigger phase transitions
 */
async function monitorActiveGames() {
  const currentTime = Date.now();
  
  // Process each active game
  for (const [gameId, gameData] of activeGames.entries()) {
    try {
      // Double check the game state from the contract
      const gameInfo = await oneCardContract.getGameInfo(gameId);
      
      // Update our local state if it doesn't match the contract
      if (gameInfo.state !== gameData.state) {
        logDebug(`Game ${gameId} state mismatch. Local: ${gameData.state}, Contract: ${gameInfo.state}`);
        
        // Update our local tracking
        gameData.state = gameInfo.state;
        
        // If game transitioned to an active phase, set up timers
        if (gameInfo.state === GameState.PEEK_PHASE || gameInfo.state === GameState.BETTING) {
          const localTimestamp = Date.now();
          const remainingTime = gameInfo.remainingTime.toNumber() * 1000; // Convert to milliseconds
          
          gameData.localEndTime = localTimestamp + remainingTime;
          
          console.log(`Updated game ${gameId} to ${GameState[gameInfo.state]} state, ending in ${Math.floor(remainingTime/1000)} seconds`);
        }
        
        activeGames.set(gameId, gameData);
      }
      
      // Handle each state
      switch (gameData.state) {
        case GameState.PRE_GAME:
          // We're monitoring games from creation, no action needed in PRE_GAME state
          // The state will change when startGame is called and PeekPhaseStarted event is emitted
          logDebug(`Game ${gameId} is in PRE_GAME state, waiting for game to start`);
          break;
          
        case GameState.PEEK_PHASE:
          // Check if peek phase has ended based on local time
          if (currentTime >= gameData.localEndTime) {
            console.log(`Ending peek phase for game ${gameId}`);
            await endPeekPhase(gameId);
          } else {
            logDebug(`Game ${gameId} peek phase remaining: ${Math.floor((gameData.localEndTime - currentTime) / 1000)} seconds`);
          }
          break;
          
        case GameState.BETTING:
          // Check if betting phase has ended based on local time
          if (currentTime >= gameData.localEndTime) {
            console.log(`Ending betting phase for game ${gameId}`);
            await endBettingPhase(gameId);
          } else {
            logDebug(`Game ${gameId} betting phase remaining: ${Math.floor((gameData.localEndTime - currentTime) / 1000)} seconds`);
          }
          break;
          
        case GameState.ENDED:
          // Clean up ended games
          console.log(`Cleaning up game ${gameId}`);
          await cleanupGame(gameId);
          
          // Remove from tracking after cleanup
          activeGames.delete(gameId);
          break;
      }
    } catch (error) {
      console.error(`Error processing game ${gameId}:`, error.message);
    }
  }
}

/**
 * End the peek phase for a game
 * @param {string} gameId - The game ID
 */
async function endPeekPhase(gameId) {
  try {
    const tx = await oneCardContract.endPeekPhase(gameId, veryHighGasTxOptions);
    console.log(`Ending peek phase transaction submitted: ${tx.hash}`);
    
    const receipt = await tx.wait();
    console.log(`Peek phase ended for game ${gameId}. Gas used: ${receipt.gasUsed.toString()}`);
    
    return receipt;
  } catch (error) {
    console.error(`Error ending peek phase for game ${gameId}:`, error.message);
    
    // If the error is "Not peek phase", update our tracking
    if (error.message.includes("Not peek phase")) {
      const gameInfo = await oneCardContract.getGameInfo(gameId);
      if (activeGames.has(gameId)) {
        const gameData = activeGames.get(gameId);
        gameData.state = gameInfo.state;
        activeGames.set(gameId, gameData);
      }
    }
  }
}

/**
 * End the betting phase for a game
 * @param {string} gameId - The game ID
 */
async function endBettingPhase(gameId) {
  try {
    const tx = await oneCardContract.endBettingPhase(gameId, veryHighGasTxOptions);
    console.log(`Ending betting phase transaction submitted: ${tx.hash}`);
    
    const receipt = await tx.wait();
    console.log(`Betting phase ended for game ${gameId}. Gas used: ${receipt.gasUsed.toString()}`);
    
    return receipt;
  } catch (error) {
    console.error(`Error ending betting phase for game ${gameId}:`, error.message);
    
    // If the error is "Not betting phase", update our tracking
    if (error.message.includes("Not betting phase")) {
      const gameInfo = await oneCardContract.getGameInfo(gameId);
      if (activeGames.has(gameId)) {
        const gameData = activeGames.get(gameId);
        gameData.state = gameInfo.state;
        activeGames.set(gameId, gameData);
      }
    }
  }
}

/**
 * Clean up a game after it has ended
 * @param {string} gameId - The game ID
 */
async function cleanupGame(gameId) {
  try {
    const tx = await oneCardContract.cleanup(gameId, highGasTxOptions);
    console.log(`Cleanup transaction submitted: ${tx.hash}`);
    
    const receipt = await tx.wait();
    console.log(`Game ${gameId} cleaned up. Gas used: ${receipt.gasUsed.toString()}`);
    
    return receipt;
  } catch (error) {
    console.error(`Error cleaning up game ${gameId}:`, error.message);
    
    // If game is already cleaned up, remove it from tracking
    if (error.message.includes("Game already cleaned up")) {
      activeGames.delete(gameId);
    }
  }
}

/**
 * Log debug messages if DEBUG is enabled
 * @param {string} message - The debug message
 */
function logDebug(message) {
  if (DEBUG) {
    console.log(`[DEBUG] ${message}`);
  }
}

/**
 * Start the keeper service
 */
async function startKeeperService() {
  if (process.argv.length < 3) {
    console.error('Error: Contract address required');
    console.log('Usage: node keeper-service.js <contract-address>');
    process.exit(1);
  }
  
  const contractAddress = process.argv[2];
  await initializeKeeper(contractAddress);
}

// Start the keeper service if this file is run directly
if (require.main === module) {
  startKeeperService().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = {
  initializeKeeper,
  endPeekPhase,
  endBettingPhase,
  cleanupGame
};