const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

// Configure logging
const logPath = path.join(__dirname, "vanilla-poker-test.txt");
let logStream = fs.createWriteStream(logPath, { flags: "a" });

function log(message) {
  const timestamp = new Date().toISOString();
  const formattedMessage = `[${timestamp}] ${message}\n`;
  logStream.write(formattedMessage);
  console.log(message);
}

// Card helper functions
function getCardValueName(value) {
  if (value >= 2 && value <= 10) return value.toString();
  if (value === 11) return "Jack";
  if (value === 12) return "Queen";
  if (value === 13) return "King";
  if (value === 14) return "Ace";
  return "Unknown";
}

function getCardSuitName(suit) {
  const suits = ["Hearts", "Diamonds", "Clubs", "Spades"];
  return suits[suit] || "Unknown";
}

function formatCard(value, suit) {
  return `${getCardValueName(value)} of ${getCardSuitName(suit)}`;
}

// Format ETH values for display
function formatEth(weiValue) {
  return ethers.utils.formatEther(weiValue);
}

// GameState enum mapping from PokerGameLibrary
const GameState = {
  0: "PRE_GAME",
  1: "PEEK_PHASE",
  2: "BETTING",
  3: "SHOWDOWN",
  4: "ENDED"
};

// Function to set up wallets from .env file
async function setupWallets(provider) {
  const wallets = [];
  
  // Check for required environment variables
  if (!process.env.OWNER_PRIVATE_KEY) {
    throw new Error("OWNER_PRIVATE_KEY is required in .env file");
  }
  
  // Owner wallet
  const ownerWallet = new ethers.Wallet(process.env.OWNER_PRIVATE_KEY, provider);
  wallets.push(ownerWallet);
  
  // Player wallets
  for (let i = 1; i <= 5; i++) {
    const privateKeyVar = `PLAYER${i}_PRIVATE_KEY`;
    if (!process.env[privateKeyVar]) {
      throw new Error(`${privateKeyVar} is required in .env file`);
    }
    const playerWallet = new ethers.Wallet(process.env[privateKeyVar], provider);
    wallets.push(playerWallet);
  }
  
  return wallets;
}

describe("Vanilla One Card Poker Game Test", function() {
  // Increase timeout for network interactions
  this.timeout(600000); // 10 minutes

  let cardLibrary;
  let gameLibrary;
  let pokerContract;
  let owner;
  let keeper;
  let players = [];
  let gameId;
  let playerCards = {};
  
  // Transaction options with higher gas settings
  const txOptions = {
    gasLimit: 2000000 // Increased for regular transactions
  };

  const highGasTxOptions = {
    gasLimit: 5000000 // Increased for complex operations
  };

  const veryHighGasTxOptions = {
    gasLimit: 15000000 // Significantly increased for very complex operations
  };

  const extremeGasTxOptions = {
    gasLimit: 30000000 // For the most gas-intensive operations like contract deployment
  };

  before(async function() {
    log("\n===== SETTING UP TEST ENVIRONMENT =====");
    
    // Set up wallets from .env
    const provider = ethers.provider;
    const wallets = await setupWallets(provider);
    
    // First wallet is owner/keeper
    owner = wallets[0];
    keeper = owner;
    
    // Player wallets (next 5)
    players = wallets.slice(1, 6);
    
    log("Wallet setup complete.");
    log(`Owner/Keeper address: ${owner.address}`);
    players.forEach((player, index) => {
      log(`Player ${index + 1} address: ${player.address}`);
    });
    
    // Check wallet balances
    log("\n----- CHECKING WALLET BALANCES -----");
    for (const wallet of [owner, ...players]) {
      const balance = await wallet.getBalance();
      const ethBalance = ethers.utils.formatEther(balance);
      log(`Address ${wallet.address} has ${ethBalance} ETH`);
      
      // Warn if balance is too low
      if (parseFloat(ethBalance) < 0.01) {
        log(`WARNING: Address ${wallet.address} has low balance. Please fund with ETH.`);
      }
    }
    
    // Deploy contracts
    log("\n----- DEPLOYING CONTRACTS -----");
    
    // First, deploy CardLibrary
    log("Deploying CardLibrary...");
    const CardLibraryFactory = await ethers.getContractFactory("contracts/vanilla/PokerCardLibrary.sol:CardLibrary", {
      signer: owner
    });
    cardLibrary = await CardLibraryFactory.deploy();
    await cardLibrary.deployed();
    log(`CardLibrary deployed at: ${cardLibrary.address}`);

    // Next, deploy GameLibrary
    log("Deploying GameLibrary...");
    const GameLibraryFactory = await ethers.getContractFactory("contracts/vanilla/PokerGameLibrary.sol:GameLibrary", {
      signer: owner
    });
    gameLibrary = await GameLibraryFactory.deploy();
    await gameLibrary.deployed();
    log(`GameLibrary deployed at: ${gameLibrary.address}`);

    // Deploy main contract
    log("Deploying OneCard main contract...");
    const PokerFactory = await ethers.getContractFactory("contracts/vanilla/OneCard.sol:OneCard", {
      signer: owner
    });
    pokerContract = await PokerFactory.deploy();
    await pokerContract.deployed();
    log(`OneCard contract deployed at: ${pokerContract.address}`);
  });
  
  it("Should play a complete game of Vanilla One Card Poker", async function() {
    log("\n===== STARTING VANILLA ONE CARD POKER TEST =====");
    
    // ===== GAME SETUP PHASE =====
    log("\n----- GAME CREATION -----");

    // Player 1 creates a game
    const gameCreator = players[0];
    log(`Player 1 (${gameCreator.address}) creating a game`);
    const createTx = await pokerContract.connect(gameCreator).createGame(highGasTxOptions);
    const createReceipt = await createTx.wait();
    
    // Extract gameId from the event logs
    const gameCreatedEvent = createReceipt.events.find(e => e.event === "GameCreated");
    gameId = gameCreatedEvent.args.gameId.toNumber();
    log(`Created Game with ID: ${gameId}`);
    
    // Look for the creator event
    const creatorEvent = createReceipt.events.find(e => e.event === "GameCreatedByPlayer");
    if (creatorEvent) {
      log(`Game creator: ${creatorEvent.args.creator}`);
    }
    
    // ===== PLAYER JOINING PHASE =====
    log("\n----- PLAYERS JOINING GAME -----");
    for (let i = 1; i < 5; i++) {  // Players 2, 3, 4, 5 need to join (player 1 is creator)
      const player = players[i];
      const joinTx = await pokerContract.connect(player).joinGame(gameId, txOptions);
      const joinReceipt = await joinTx.wait();
      log(`Player ${i+1} (${player.address}) joined the game`);
    }
    
    // Verify game info before starting
    log("\n----- VERIFYING GAME INFO BEFORE START -----");
    const gameInfo = await pokerContract.getGameInfo(gameId);
    log(`Game state: ${GameState[gameInfo.state]}`);
    log(`Player count: ${gameInfo.playerCount.toString()}`);
    log(`Active count: ${gameInfo.activeCount.toString()}`);
    log(`Creator: ${gameInfo.creator}`);
    
    // ===== GAME START PHASE =====
    log("\n----- STARTING THE GAME -----");
    const startGameTx = await pokerContract.connect(gameCreator).startGame(gameId, veryHighGasTxOptions);
    log("startGame transaction submitted, waiting for confirmation...");
    const startGameReceipt = await startGameTx.wait();
    log("startGame transaction confirmed!");
    
    // Look for the buffer period event
    const bufferEvent = startGameReceipt.events.find(e => e.event === "BufferPeriodStarted");
    if (bufferEvent) {
      log(`Buffer period started before peek phase. Current state: ${GameState[bufferEvent.args.currentState]}, Next state: ${GameState[bufferEvent.args.nextState]}`);
    }
    
    const peekPhaseEvent = startGameReceipt.events.find(e => e.event === "PeekPhaseStarted");
    if (peekPhaseEvent) {
      log(`Peek phase started for game ${gameId}`);
    }
    
    // Get updated game info
    const updatedGameInfo = await pokerContract.getGameInfo(gameId);
    log(`Game state: ${GameState[updatedGameInfo.state]}`);
    log(`Phase end time: ${new Date(updatedGameInfo.phaseEndTime * 1000).toISOString()}`);
    log(`Buffer end time: ${new Date(updatedGameInfo.bufferEndTime * 1000).toISOString()}`);
    
    // Wait for buffer period to end
    log("\n----- WAITING FOR BUFFER PERIOD TO END -----");
    
    // Fetch the buffer period duration directly from the contract
    const PHASE_TRANSITION_BUFFER_FROM_CONTRACT = await pokerContract.PHASE_TRANSITION_BUFFER();
    // Convert from BigNumber to seconds
    const PHASE_TRANSITION_BUFFER_SECONDS = PHASE_TRANSITION_BUFFER_FROM_CONTRACT.toNumber();
    // For local testing, use shorter durations to speed things up
    const PHASE_TRANSITION_BUFFER = network.name === "hardhat" ? 3 : PHASE_TRANSITION_BUFFER_SECONDS;
    log(`Buffer period duration from contract: ${PHASE_TRANSITION_BUFFER_SECONDS} seconds`);
    log(`Using ${PHASE_TRANSITION_BUFFER} seconds ${network.name === "hardhat" ? "(reduced for testing)" : ""} for buffer period`);
    
    // Note the current real-world time when we received the event
    const bufferStartTime = Date.now();
    const bufferEndTime = bufferStartTime + (PHASE_TRANSITION_BUFFER * 1000); // Convert to milliseconds
    
    // Calculate how long to wait
    const waitTimeMs = bufferEndTime - Date.now();
    
    if (waitTimeMs > 0) {
      log(`Waiting ${Math.ceil(waitTimeMs/1000)} seconds for buffer period to end in real time...`);
      await new Promise(resolve => setTimeout(resolve, waitTimeMs + 1000)); // Add 1 second extra for safety
    }
    
    log("Buffer period has ended");
    
    // ===== PEEK PHASE =====
    log("\n----- PLAYERS PEEKING AT CARDS -----");

    // Set up event listener for CardPeeked events
    pokerContract.on("CardPeeked", async (player, value, suit) => {
      const cardString = formatCard(Number(value), Number(suit));
      playerCards[player] = { value, suit, cardString };
      log(`Card for ${player}: ${cardString}`);
    });
    
    // Store initial chip balances
    const initialChipBalances = {};
    
    // Players peek at their cards
    for (let i = 0; i < 5; i++) {
      const player = players[i];
      try {
        // Get initial chip balance
        const playerInfoBefore = await pokerContract.getPlayerInfo(gameId, player.address);
        initialChipBalances[player.address] = playerInfoBefore.chipBalance;
        log(`Player ${i+1} initial chip balance: ${playerInfoBefore.chipBalance}`);
        
        const peekTx = await pokerContract.connect(player).peekAtCard(gameId, highGasTxOptions);
        const peekReceipt = await peekTx.wait();
        log(`Player ${i+1} (${player.address}) peeked at their card`);
        
        // Get chip balance after peeking
        const playerInfoAfter = await pokerContract.getPlayerInfo(gameId, player.address);
        log(`Player ${i+1} chip balance after peeking: ${playerInfoAfter.chipBalance}`);
      } catch (error) {
        log(`Error when Player ${i+1} tried to peek: ${error.message}`);
      }
    }
    
    // Player 2 will swap their card
    log("\n----- PLAYER SWAPPING CARD -----");
    try {
      const swapPlayer = players[1]; // Player 2
      
      // Get initial balance before swap
      const playerInfoBeforeSwap = await pokerContract.getPlayerInfo(gameId, swapPlayer.address);
      log(`Player 2 chip balance before swap: ${playerInfoBeforeSwap.chipBalance}`);
      
      const swapTx = await pokerContract.connect(swapPlayer).swapCard(gameId, highGasTxOptions);
      const swapReceipt = await swapTx.wait();
      log(`Player 2 (${swapPlayer.address}) swapped their card`);
      
      // Get chip balance after swapping
      const playerInfoAfterSwap = await pokerContract.getPlayerInfo(gameId, swapPlayer.address);
      log(`Player 2 chip balance after swap: ${playerInfoAfterSwap.chipBalance}`);
    } catch (error) {
      log(`Error when Player 2 tried to swap card: ${error.message}`);
    }
    
    // Log all player actions and chip balances after peek phase
    log("\n----- PLAYER STATUS AFTER PEEK PHASE -----");
    for (let i = 0; i < 4; i++) {
      try {
        const playerInfo = await pokerContract.getPlayerInfo(gameId, players[i].address);
        log(`Player ${i+1} (${players[i].address}):`);
        log(`  Chip balance: ${playerInfo.chipBalance}`);
        log(`  Has peeked: ${playerInfo.hasPeeked}`);
        log(`  Has swapped card: ${playerInfo.hasSwappedCard}`);
      } catch (error) {
        log(`Error getting info for Player ${i+1}: ${error.message}`);
      }
    }
    
    // ===== END PEEK PHASE =====
    log("\n----- WAITING FOR PEEK PHASE TO END -----");
    
    // Fetch the peek phase duration directly from the contract
    const PEEK_PHASE_DURATION_FROM_CONTRACT = await pokerContract.PEEK_PHASE_DURATION();
    // Convert from BigNumber to seconds
    const PEEK_PHASE_DURATION_SECONDS = PEEK_PHASE_DURATION_FROM_CONTRACT.toNumber();
    // For local testing, use shorter durations to speed things up
    const PEEK_PHASE_DURATION = network.name === "hardhat" ? 10 : PEEK_PHASE_DURATION_SECONDS;
    log(`Peek phase duration from contract: ${PEEK_PHASE_DURATION_SECONDS} seconds`);
    log(`Using ${PEEK_PHASE_DURATION} seconds ${network.name === "hardhat" ? "(reduced for testing)" : ""} for peek phase`);
    
    // Use the buffered start time (when buffer period ended) to calculate peek phase end time
    const peekPhaseStartTime = Date.now(); // When peek phase actually starts for our test
    const peekPhaseEndTime = peekPhaseStartTime + (PEEK_PHASE_DURATION * 1000); // Convert to milliseconds
    
    // Calculate how long to wait
    const peekWaitTimeMs = peekPhaseEndTime - Date.now();
    
    if (peekWaitTimeMs > 0) {
      log(`Waiting ${Math.ceil(peekWaitTimeMs/1000)} seconds for peek phase to end in real time...`);
      await new Promise(resolve => setTimeout(resolve, peekWaitTimeMs + 1000)); // Add 1 second extra for safety
    }
    
    log("Peek phase has ended");
    
    // End peek phase and start betting phase
    log("\n----- ENDING PEEK PHASE -----");
    try {
      const endPeekTx = await pokerContract.connect(keeper).endPeekPhase(gameId, veryHighGasTxOptions);
      log("endPeekPhase transaction submitted, waiting for confirmation...");
      const endPeekReceipt = await endPeekTx.wait();
      log("endPeekPhase transaction confirmed!");
      
      // Look for the buffer period event
      const bufferEvent = endPeekReceipt.events.find(e => e.event === "BufferPeriodStarted");
      if (bufferEvent) {
        log(`Buffer period started before betting phase. Current state: ${GameState[bufferEvent.args.currentState]}, Next state: ${GameState[bufferEvent.args.nextState]}`);
      }
      
      const bettingPhaseEvent = endPeekReceipt.events.find(e => e.event === "BettingPhaseStarted");
      if (bettingPhaseEvent) {
        log(`Betting phase started for game ${gameId}`);
      }
      
      // Get updated game info with phase end time
      const updatedGameInfo = await pokerContract.getGameInfo(gameId);
      log(`Phase end time: ${new Date(updatedGameInfo.phaseEndTime * 1000).toISOString()}`);
      log(`Buffer end time: ${new Date(updatedGameInfo.bufferEndTime * 1000).toISOString()}`);
      
      // Wait for buffer period to end
      log("\n----- WAITING FOR BUFFER PERIOD BEFORE BETTING PHASE -----");
      
      // Fetch the buffer period duration directly from the contract
      const PHASE_TRANSITION_BUFFER_FROM_CONTRACT = await pokerContract.PHASE_TRANSITION_BUFFER();
      // Convert from BigNumber to seconds
      const PHASE_TRANSITION_BUFFER_SECONDS = PHASE_TRANSITION_BUFFER_FROM_CONTRACT.toNumber();
      // For local testing, use shorter durations to speed things up
      const PHASE_TRANSITION_BUFFER = network.name === "hardhat" ? 3 : PHASE_TRANSITION_BUFFER_SECONDS;
      log(`Buffer period duration from contract: ${PHASE_TRANSITION_BUFFER_SECONDS} seconds`);
      log(`Using ${PHASE_TRANSITION_BUFFER} seconds ${network.name === "hardhat" ? "(reduced for testing)" : ""} for buffer period`);
      
      // Note when the buffer period starts (right after we received confirmation of endPeekPhase)
      const bufferBeforeBettingStartTime = Date.now();
      const bufferBeforeBettingEndTime = bufferBeforeBettingStartTime + (PHASE_TRANSITION_BUFFER * 1000); // Convert to milliseconds
      
      // Calculate how long to wait
      const bufferBeforeBettingWaitMs = bufferBeforeBettingEndTime - Date.now();
      
      if (bufferBeforeBettingWaitMs > 0) {
        log(`Waiting ${Math.ceil(bufferBeforeBettingWaitMs/1000)} seconds for buffer period to end in real time...`);
        await new Promise(resolve => setTimeout(resolve, bufferBeforeBettingWaitMs + 1000)); // Add 1 second extra for safety
      }
      
      log("Buffer period before betting phase has ended");
      
      // ===== BETTING PHASE =====
      log("\n----- PLAYERS PLACING BETS -----");
      
      // First player places a bet
      const bet1Amount = 5;
      try {
        const bet1Tx = await pokerContract.connect(players[0]).placeBet(gameId, bet1Amount, highGasTxOptions);
        const bet1Receipt = await bet1Tx.wait();
        log(`Player 1 (${players[0].address}) bet ${bet1Amount} chips`);
        
        // Check pot amount and current bet
        const gameStateAfterBet1 = await pokerContract.getGameInfo(gameId);
        log(`Pot after bet 1: ${gameStateAfterBet1.potAmount.toString()}, Current bet: ${gameStateAfterBet1.currentBet.toString()}`);
      } catch (error) {
        log(`Error when Player 1 tried to bet: ${error.message}`);
      }
      
      // Second player calls
      const bet2Amount = 5;
      try {
        const bet2Tx = await pokerContract.connect(players[1]).placeBet(gameId, bet2Amount, highGasTxOptions);
        const bet2Receipt = await bet2Tx.wait();
        log(`Player 2 (${players[1].address}) bet ${bet2Amount} chips`);
        
        // Check pot amount and current bet
        const gameStateAfterBet2 = await pokerContract.getGameInfo(gameId);
        log(`Pot after bet 2: ${gameStateAfterBet2.potAmount.toString()}, Current bet: ${gameStateAfterBet2.currentBet.toString()}`);
      } catch (error) {
        log(`Error when Player 2 tried to bet: ${error.message}`);
      }
      
      // Third player raises
      const bet3Amount = 10;
      try {
        const bet3Tx = await pokerContract.connect(players[2]).placeBet(gameId, bet3Amount, highGasTxOptions);
        const bet3Receipt = await bet3Tx.wait();
        log(`Player 3 (${players[2].address}) bet ${bet3Amount} chips (raising to 10)`);
        
        // Check pot amount and current bet
        const gameStateAfterBet3 = await pokerContract.getGameInfo(gameId);
        log(`Pot after bet 3: ${gameStateAfterBet3.potAmount.toString()}, Current bet: ${gameStateAfterBet3.currentBet.toString()}`);
      } catch (error) {
        log(`Error when Player 3 tried to bet: ${error.message}`);
      }
      
      // Note: With the updated contract, players can only bet once.
      // First player cannot call the raise as they already bet
      try {
        log(`Player 1 (${players[0].address}) would call the raise, but can only bet once`);
        // This should fail:
        // const bet4Tx = await pokerContract.connect(players[0]).placeBet(gameId, 5, highGasTxOptions);
      } catch (error) {
        log(`Expected error when Player 1 tried to bet again: ${error.message}`);
      }
      
      // Second player cannot call the raise as they already bet
      try {
        log(`Player 2 (${players[1].address}) would call the raise, but can only bet once`);
        // This should fail:
        // const bet5Tx = await pokerContract.connect(players[1]).placeBet(gameId, 5, highGasTxOptions);
      } catch (error) {
        log(`Expected error when Player 2 tried to bet again: ${error.message}`);
      }
      
      // Fourth player folds
      try {
        const foldTx = await pokerContract.connect(players[3]).fold(gameId, highGasTxOptions);
        const foldReceipt = await foldTx.wait();
        log(`Player 4 (${players[3].address}) folded`);
        
        // Check active player count
        const gameStateAfterFold = await pokerContract.getGameInfo(gameId);
        log(`Active players after fold: ${gameStateAfterFold.activeCount.toString()}`);
      } catch (error) {
        log(`Error when Player 4 tried to fold: ${error.message}`);
      }
      
      // Fifth player places a bet
      const bet4Amount = 10; // Match player 3's bet
      try {
        const bet4Tx = await pokerContract.connect(players[4]).placeBet(gameId, bet4Amount, highGasTxOptions);
        const bet4Receipt = await bet4Tx.wait();
        log(`Player 5 (${players[4].address}) bet ${bet4Amount} chips (matching the current bet)`);
        
        // Check pot amount and current bet
        const gameStateAfterBet4 = await pokerContract.getGameInfo(gameId);
        log(`Pot after player 5's bet: ${gameStateAfterBet4.potAmount.toString()}, Current bet: ${gameStateAfterBet4.currentBet.toString()}`);
      } catch (error) {
        log(`Error when Player 5 tried to bet: ${error.message}`);
      }
      
      // Log player status after betting
      log("\n----- PLAYER STATUS AFTER BETTING -----");
      for (let i = 0; i < 5; i++) {
        try {
          const playerInfo = await pokerContract.getPlayerInfo(gameId, players[i].address);
          log(`Player ${i+1} (${players[i].address}):`);
          log(`  Chip balance: ${playerInfo.chipBalance}`);
          log(`  Current bet: ${playerInfo.currentBet}`);
          log(`  Has folded: ${playerInfo.hasFolded}`);
        } catch (error) {
          log(`Error getting info for Player ${i+1}: ${error.message}`);
        }
      }
      
      // Check if all players have matched bets
      const allMatched = await pokerContract.checkAllPlayersMatched(gameId);
      log(`Have all active players matched the current bet? ${allMatched}`);
      
      // Wait for betting phase to end using contract-defined duration
      log("\n----- WAITING FOR BETTING PHASE TO END -----");
      
      // Fetch the betting phase duration directly from the contract
      const BETTING_PHASE_DURATION_FROM_CONTRACT = await pokerContract.BETTING_PHASE_DURATION();
      // Convert from BigNumber to seconds
      const BETTING_PHASE_DURATION_SECONDS = BETTING_PHASE_DURATION_FROM_CONTRACT.toNumber();
      // For local testing, use shorter durations to speed things up
      const BETTING_PHASE_DURATION = network.name === "hardhat" ? 15 : BETTING_PHASE_DURATION_SECONDS;
      log(`Betting phase duration from contract: ${BETTING_PHASE_DURATION_SECONDS} seconds`);
      log(`Using ${BETTING_PHASE_DURATION} seconds ${network.name === "hardhat" ? "(reduced for testing)" : ""} for betting phase`);
      
      // Note when the betting phase starts (right after buffer before betting ends)
      const bettingPhaseStartTime = Date.now();
      const bettingPhaseEndTime = bettingPhaseStartTime + (BETTING_PHASE_DURATION * 1000); // Convert to milliseconds
      
      // Calculate how long to wait
      const bettingWaitTimeMs = bettingPhaseEndTime - Date.now();
      
      if (bettingWaitTimeMs > 0) {
        log(`Waiting ${Math.ceil(bettingWaitTimeMs/1000)} seconds for betting phase to end in real time...`);
        await new Promise(resolve => setTimeout(resolve, bettingWaitTimeMs + 1000)); // Add 1 second extra for safety
      }
      
      log("Betting phase has ended");
      
      // Set up listener for GameEnded event
      let gameEndedPromise = new Promise((resolve) => {
        const gameEndedListener = pokerContract.once("GameEnded", async (gameIdEvent, winner, potAmount) => {
          if (gameIdEvent.toString() === gameId.toString()) {
            log(`\n===== GAME ENDED EVENT CAPTURED =====`);
            log(`Winner: ${winner}`);
            log(`Pot Amount: ${potAmount.toString()} chips`);
            
            // Find which player number won
            const winnerIndex = players.findIndex(p => p.address.toLowerCase() === winner.toLowerCase());
            if (winnerIndex !== -1) {
              log(`Player ${winnerIndex + 1} (${players[winnerIndex].address}) won the game!`);
            }
            
            resolve({ winner, potAmount });
          }
        });
        
        // Ensure we clean up the listener after a timeout
        setTimeout(() => {
          pokerContract.removeListener("GameEnded", gameEndedListener);
          resolve({ winner: null, potAmount: 0 });
        }, 300000); // 5 minute timeout
      });
      
      // End betting phase and start showdown
      log("\n----- ENDING BETTING PHASE -----");
      try {
        const endBettingTx = await pokerContract.connect(keeper).endBettingPhase(gameId, veryHighGasTxOptions);
        log("endBettingPhase transaction submitted, waiting for confirmation...");
        const endBettingReceipt = await endBettingTx.wait();
        log("endBettingPhase transaction confirmed!");
        
        // Look for showdown event
        const showdownEvent = endBettingReceipt.events.find(e => e.event === "ShowdownStarted");
        if (showdownEvent) {
          log("Showdown phase started");
        }
        
        // Look for game ended event
        const gameEndedEvent = endBettingReceipt.events.find(e => e.event === "GameEnded");
        if (gameEndedEvent) {
          const winner = gameEndedEvent.args.winner;
          const potAmount = gameEndedEvent.args.potAmount.toString();
          
          log(`\n===== GAME RESULTS =====`);
          log(`Winner: ${winner}`);
          log(`Pot Amount: ${potAmount} chips`);
          
          // Find which player number won
          const winnerIndex = players.findIndex(p => p.address.toLowerCase() === winner.toLowerCase());
          if (winnerIndex !== -1) {
            log(`Player ${winnerIndex + 1} (${players[winnerIndex].address}) won the game!`);
          }
        } else {
          log("Game ended event not found in transaction logs - waiting for async event");
          // Wait for the event promise to resolve
          const gameEndResult = await gameEndedPromise;
          if (gameEndResult.winner) {
            log(`Async winner detection: ${gameEndResult.winner}`);
          } else {
            log("Failed to detect winner asynchronously");
          }
        }
        
        // ===== FINAL GAME STATE =====
        log("\n----- FINAL GAME STATE -----");
        try {
          const finalGameState = await pokerContract.getGameInfo(gameId);
          log(`Game state: ${GameState[finalGameState.state]}`);
          log(`Pot amount: ${finalGameState.potAmount.toString()}`);
          
          // Get final player balances
          log("\n----- FINAL PLAYER BALANCES -----");
          for (let i = 0; i < 5; i++) {
            try {
              const playerInfo = await pokerContract.getPlayerInfo(gameId, players[i].address);
              log(`Player ${i+1} (${players[i].address}):`);
              log(`  Initial balance: ${initialChipBalances[players[i].address]}`);
              log(`  Final balance: ${playerInfo.chipBalance}`);
              const difference = playerInfo.chipBalance - initialChipBalances[players[i].address];
              log(`  Difference: ${difference}`);
              
              // Check if this player gained chips (potential winner)
              if (difference > 0) {
                log(`*** Player ${i+1} gained ${difference} chips - WINNER! ***`);
              }
            } catch (error) {
              log(`Error getting info for Player ${i+1}: ${error.message}`);
            }
          }
          
          // Cleanup the game
          log("\n----- CLEANING UP THE GAME -----");
          try {
            const cleanupTx = await pokerContract.connect(keeper).cleanup(gameId, highGasTxOptions);
            await cleanupTx.wait();
            log("Game cleaned up successfully");
            
            // Check if game is now marked as cleaned up
            const finalGameInfo = await pokerContract.getGameInfo(gameId);
            log(`Game is cleaned up: ${finalGameInfo.isCleanedUp}`);
          } catch (error) {
            log(`Error cleaning up game: ${error.message}`);
          }
        } catch (error) {
          log(`Error getting final game info: ${error.message}`);
        }
      } catch (error) {
        log(`Error ending betting phase: ${error.message}`);
      }
    } catch (error) {
      log(`Error ending peek phase: ${error.message}`);
    }
    
    log("\n===== VANILLA ONE CARD POKER TEST COMPLETED =====");
    
    // Close the log file
    logStream.end();
  });
});