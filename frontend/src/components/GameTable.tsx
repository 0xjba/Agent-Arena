import React, { useEffect, useState } from 'react';
import { Eye, RefreshCw, X, Trophy, Coins, Timer } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { getGameInfo, getPlayers, getPlayerInfo, peekAtCard, swapCard, placeBet, fold, startGame, leaveGame, GameInfo, GameState, PlayerInfo, setupEventListeners } from '../lib/contract';
import toast from 'react-hot-toast';

interface GameTableProps {
  gameId: number;
  playerAddress: string;
  onLeave: () => void;
}

interface PlayerPosition {
  address: string | null;
  info: PlayerInfo | null;
  position: number;
  card?: {
    value: number;
    suit: number;
  };
  isWinner?: boolean;
  showSwapAnimation?: boolean;
  hasFolded?: boolean;
}

const EMPTY_POSITIONS: PlayerPosition[] = Array(5).fill(null).map((_, i) => ({
  address: null,
  info: null,
  position: i
}));

const CARD_SUITS = ['♠', '♥', '♦', '♣'];
// Maps card values from contract (2-14) to display values
const CARD_VALUES = {
  2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10', 
  11: 'J', 12: 'Q', 13: 'K', 14: 'A'
};

const TABLE_GRADIENT = 'radial-gradient(circle at center, #1a472a 0%, #0f2b19 100%)';

const PHASE_DURATIONS = {
  [GameState.PEEK_PHASE]: 120,
  [GameState.BETTING_PHASE]: 300,
};

const STORAGE_KEYS = {
  PHASE_START: (gameId: number) => `game_${gameId}_phase_start`,
  CURRENT_PHASE: (gameId: number) => `game_${gameId}_current_phase`,
  PEEKED_CARDS: (gameId: number) => `game_${gameId}_peeked_cards`,
  WINNER: (gameId: number) => `game_${gameId}_winner`,
};

export function GameTable({ gameId, playerAddress, onLeave }: GameTableProps) {
  const [gameInfo, setGameInfo] = useState<GameInfo | null>(null);
  const [positions, setPositions] = useState<PlayerPosition[]>(EMPTY_POSITIONS);
  const [isStarting, setIsStarting] = useState(false);
  const [isPeeking, setIsPeeking] = useState(false);
  const [isSwapping, setIsSwapping] = useState(false);
  const [betAmount, setBetAmount] = useState<string>('1');
  const [isBetting, setIsBetting] = useState(false);
  const [isFolding, setIsFolding] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);
  const [winner, setWinner] = useState<string | null>(null);
  const [showdown, setShowdown] = useState(false);
  const [remainingTime, setRemainingTime] = useState<number | null>(null);
  const [hasPlacedBet, setHasPlacedBet] = useState(false);

  const startPhaseTimer = (phase: GameState) => {
    const now = Date.now();
    localStorage.setItem(STORAGE_KEYS.PHASE_START(gameId), now.toString());
    localStorage.setItem(STORAGE_KEYS.CURRENT_PHASE(gameId), phase.toString());
  };

  const getPhaseTimer = () => {
    const storedPhase = localStorage.getItem(STORAGE_KEYS.CURRENT_PHASE(gameId));
    const storedStart = localStorage.getItem(STORAGE_KEYS.PHASE_START(gameId));
    
    if (!storedPhase || !storedStart) return null;

    const phase = parseInt(storedPhase);
    const start = parseInt(storedStart);
    const now = Date.now();
    const elapsed = now - start;
    const duration = PHASE_DURATIONS[phase as GameState] * 1000;
    const remaining = Math.max(0, duration - elapsed);

    return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
  };

  const savePeekedCard = (player: string, card: { value: number; suit: number } | null) => {
    const peekedCards = JSON.parse(localStorage.getItem(STORAGE_KEYS.PEEKED_CARDS(gameId)) || '{}');
    if (card === null) {
      delete peekedCards[player.toLowerCase()];
    } else {
      peekedCards[player.toLowerCase()] = card;
    }
    localStorage.setItem(STORAGE_KEYS.PEEKED_CARDS(gameId), JSON.stringify(peekedCards));
  };

  const getPeekedCard = (player: string) => {
    const peekedCards = JSON.parse(localStorage.getItem(STORAGE_KEYS.PEEKED_CARDS(gameId)) || '{}');
    return peekedCards[player.toLowerCase()];
  };

  const saveWinner = (winner: string) => {
    localStorage.setItem(STORAGE_KEYS.WINNER(gameId), winner.toLowerCase());
  };

  const getWinner = () => {
    return localStorage.getItem(STORAGE_KEYS.WINNER(gameId));
  };

  useEffect(() => {
    const storedWinner = getWinner();
    if (storedWinner) {
      setWinner(storedWinner);
      setPositions(prev => prev.map(pos => ({
        ...pos,
        isWinner: pos.address?.toLowerCase() === storedWinner.toLowerCase()
      })));
    }
  }, []);

  useEffect(() => {
    if (gameInfo?.state !== GameState.PRE_GAME && gameInfo?.state !== GameState.SHOWDOWN) {
      const interval = setInterval(() => {
        const remaining = getPhaseTimer();
        if (remaining !== null) {
          setRemainingTime(remaining);
          if (remaining === 0) {
            clearInterval(interval);
            pollGameState();
          }
        }
      }, 1000);

      return () => clearInterval(interval);
    }
  }, [gameInfo?.state]);

  useEffect(() => {
    pollGameState();
    const interval = setInterval(pollGameState, 3000);

    const cleanup = setupEventListeners(gameId, {
      onCardPeeked: (player, value, suit) => {
        if (player.toLowerCase() === playerAddress.toLowerCase()) {
          // Convert values to numbers as they might come as BigNumber
          const cardValue = typeof value === 'object' ? value.toNumber() : Number(value);
          const cardSuit = typeof suit === 'object' ? suit.toNumber() : Number(suit);
          
          console.log(`Card peeked: Value=${cardValue} (${CARD_VALUES[cardValue]}), Suit=${cardSuit} (${CARD_SUITS[cardSuit]})`);
          
          const card = { value: cardValue, suit: cardSuit };
          savePeekedCard(player, card);
          setPositions(prev => prev.map(pos => 
            pos.address?.toLowerCase() === player.toLowerCase()
              ? { ...pos, card }
              : pos
          ));
        }
      },
      onPlayerPeeked: (gameId, player) => {
        setPositions(prev => prev.map(pos =>
          pos.address?.toLowerCase() === player.toLowerCase()
            ? { ...pos, info: pos.info ? { ...pos.info, hasPeeked: true } : null }
            : pos
        ));
      },
      onCardSwapped: (gameId, player) => {
        savePeekedCard(player, null);
        setPositions(prev => prev.map(pos =>
          pos.address?.toLowerCase() === player.toLowerCase()
            ? { 
                ...pos, 
                card: null,
                info: pos.info ? { ...pos.info, hasSwappedCard: true } : null,
                showSwapAnimation: true
              }
            : pos
        ));
        
        setTimeout(() => {
          setPositions(prev => prev.map(pos =>
            pos.address?.toLowerCase() === player.toLowerCase()
              ? { ...pos, showSwapAnimation: false }
              : pos
          ));
        }, 2000);
      },
      onPeekPhaseStarted: () => {
        startPhaseTimer(GameState.PEEK_PHASE);
        setHasPlacedBet(false);
        toast.success('Peek phase started! You have 2 minutes to peek and swap cards.', { duration: 5000 });
      },
      onBettingPhaseStarted: () => {
        startPhaseTimer(GameState.BETTING_PHASE);
        toast.success('Betting phase started! You have 5 minutes to place your bets.', { duration: 5000 });
      },
      onShowdownStarted: () => {
        setShowdown(true);
        localStorage.removeItem(STORAGE_KEYS.PHASE_START(gameId));
        localStorage.removeItem(STORAGE_KEYS.CURRENT_PHASE(gameId));
        toast.success('Showdown phase! All cards will be revealed.', { duration: 10000 });
        pollGameState();
      },
      onCardRevealed: (gameId, player, value, suit) => {
        // Convert values to numbers as they might come as BigNumber
        const cardValue = typeof value === 'object' ? value.toNumber() : Number(value);
        const cardSuit = typeof suit === 'object' ? suit.toNumber() : Number(suit);
        
        console.log(`Card revealed: Player=${player}, Value=${cardValue} (${CARD_VALUES[cardValue]}), Suit=${cardSuit} (${CARD_SUITS[cardSuit]})`);
        
        setPositions(prev => prev.map(pos => 
          pos.address?.toLowerCase() === player.toLowerCase()
            ? { ...pos, card: { value: cardValue, suit: cardSuit } }
            : pos
        ));
      },
      onGameEnded: async (gameId, winner, potAmount) => {
        // Save winner information
        setWinner(winner);
        saveWinner(winner);
        setShowdown(true);
        
        // Mark winner in positions
        setPositions(prev => prev.map(pos => ({
          ...pos,
          isWinner: pos.address?.toLowerCase() === winner.toLowerCase()
        })));
        
        // Display toast for winner
        toast.success(`Game ended! ${winner.slice(0, 6)}...${winner.slice(-4)} won ${potAmount} chips!`, { 
          duration: 10000,
          icon: '🏆'
        });
        
        // Get revealed cards after a short delay to ensure contract state is updated
        setTimeout(async () => {
          try {
            const revealedCards = await getRevealedCards(gameId);
            console.log("Game ended - Revealed cards:", revealedCards);
            
            if (revealedCards && revealedCards.players && revealedCards.players.length > 0) {
              const cardMap = {};
              for (let i = 0; i < revealedCards.players.length; i++) {
                const player = revealedCards.players[i];
                const value = Number(revealedCards.values[i]);
                const suit = Number(revealedCards.suits[i]);
                cardMap[player.toLowerCase()] = { value, suit };
              }
              
              // Update positions with revealed cards
              setPositions(prev => prev.map(pos => {
                if (pos.address && cardMap[pos.address.toLowerCase()]) {
                  return { 
                    ...pos, 
                    card: cardMap[pos.address.toLowerCase()],
                    isWinner: pos.address?.toLowerCase() === winner.toLowerCase()
                  };
                }
                return pos;
              }));
            }
          } catch (error) {
            console.error("Error fetching revealed cards after game end:", error);
          }
        }, 2000);
        
        // Also poll game state to get updated info
        pollGameState();
      }
    });

    return () => {
      clearInterval(interval);
      cleanup?.();
      localStorage.removeItem(STORAGE_KEYS.PHASE_START(gameId));
      localStorage.removeItem(STORAGE_KEYS.CURRENT_PHASE(gameId));
      localStorage.removeItem(STORAGE_KEYS.PEEKED_CARDS(gameId));
      localStorage.removeItem(STORAGE_KEYS.WINNER(gameId));
    };
  }, [gameId, playerAddress]);

  const pollGameState = async () => {
    try {
      const [info, players] = await Promise.all([
        getGameInfo(gameId),
        getPlayers(gameId)
      ]);

      // Check if game is in showdown or ended state
      if (info.state === GameState.SHOWDOWN || info.state === GameState.ENDED) {
        setShowdown(true);
        
        // Try to get revealed cards if in showdown/ended state
        try {
          const revealedCards = await getRevealedCards(gameId);
          console.log("Revealed cards:", revealedCards);
          
          // Update positions with revealed cards
          if (revealedCards && revealedCards.players && revealedCards.players.length > 0) {
            const cardMap = {};
            for (let i = 0; i < revealedCards.players.length; i++) {
              const player = revealedCards.players[i];
              const value = Number(revealedCards.values[i]);
              const suit = Number(revealedCards.suits[i]);
              cardMap[player.toLowerCase()] = { value, suit };
              console.log(`Revealed card for ${player}: Value=${value} (${CARD_VALUES[value]}), Suit=${suit} (${CARD_SUITS[suit]})`);
            }
            
            // Update positions with revealed cards
            setPositions(prev => prev.map(pos => {
              if (pos.address && cardMap[pos.address.toLowerCase()]) {
                return { ...pos, card: cardMap[pos.address.toLowerCase()] };
              }
              return pos;
            }));
          }
        } catch (error) {
          console.error("Error fetching revealed cards:", error);
        }
      }

      const playerInfos = await Promise.all(
        players.map(async (addr) => ({
          address: addr,
          info: await getPlayerInfo(gameId, addr)
        }))
      );

      const storedWinner = getWinner();
      const newPositions = [...EMPTY_POSITIONS];
      playerInfos.forEach((player, index) => {
        const peekedCard = getPeekedCard(player.address);
        newPositions[index] = {
          ...newPositions[index],
          address: player.address,
          info: player.info,
          card: peekedCard || positions[index]?.card || null,
          isWinner: storedWinner ? player.address.toLowerCase() === storedWinner.toLowerCase() : positions[index]?.isWinner,
          showSwapAnimation: positions[index]?.showSwapAnimation,
          hasFolded: player.info.hasFolded
        };
      });

      const currentPlayer = playerInfos.find(p => p.address.toLowerCase() === playerAddress.toLowerCase());
      if (currentPlayer && currentPlayer.info.currentBet > 0) {
        setHasPlacedBet(true);
      }

      // Display winner toast if game just ended and we have winner data
      const prevState = gameInfo?.state;
      if (prevState !== GameState.ENDED && info.state === GameState.ENDED && storedWinner) {
        const winnerPlayer = playerInfos.find(p => p.address.toLowerCase() === storedWinner.toLowerCase());
        const winnerName = storedWinner ? `${storedWinner.slice(0, 6)}...${storedWinner.slice(-4)}` : 'Unknown';
        
        toast.success(`Game ended! ${winnerName} won ${info.potAmount} chips!`, { 
          duration: 10000,
          icon: '🏆'
        });
      }

      setGameInfo(info);
      setPositions(newPositions);
    } catch (error) {
      console.error('Error polling game state:', error);
    }
  };

  const handleStartGame = async () => {
    try {
      setIsStarting(true);
      await startGame(gameId);
      toast.success('Game started!', { duration: 5000 });
    } catch (error) {
      console.error('Error starting game:', error);
      toast.error('Failed to start game');
    } finally {
      setIsStarting(false);
    }
  };

  const handlePeekCard = async () => {
    try {
      setIsPeeking(true);
      await peekAtCard(gameId);
      toast.success('Card peeked successfully!', { duration: 5000 });
    } catch (error) {
      console.error('Error peeking at card:', error);
      toast.error('Failed to peek at card');
    } finally {
      setIsPeeking(false);
    }
  };

  const handleSwapCard = async () => {
    try {
      setIsSwapping(true);
      await swapCard(gameId);
      toast.success('Card swapped successfully!', { duration: 5000 });
    } catch (error) {
      console.error('Error swapping card:', error);
      toast.error('Failed to swap card');
    } finally {
      setIsSwapping(false);
    }
  };

  const handlePlaceBet = async () => {
    const amount = parseInt(betAmount) || 1;
    const playerInfo = positions.find(p => p.address?.toLowerCase() === playerAddress.toLowerCase())?.info;
    
    if (!playerInfo) return;

    if (amount > playerInfo.chipBalance) {
      toast.error(`Not enough chips! You only have ${playerInfo.chipBalance} chips.`);
      return;
    }

    if (hasPlacedBet) {
      toast.error('You have already placed a bet in this round!');
      return;
    }

    try {
      setIsBetting(true);
      await placeBet(gameId, amount);
      setHasPlacedBet(true);
      toast.success('Bet placed successfully!', { duration: 5000 });
    } catch (error) {
      console.error('Error placing bet:', error);
      toast.error('Failed to place bet');
    } finally {
      setIsBetting(false);
    }
  };

  const handleFold = async () => {
    try {
      setIsFolding(true);
      await fold(gameId);
      toast.success('Folded successfully!', { duration: 5000 });
    } catch (error) {
      console.error('Error folding:', error);
      toast.error('Failed to fold');
    } finally {
      setIsFolding(false);
    }
  };

  const handleLeaveGame = async () => {
    try {
      setIsLeaving(true);
      await leaveGame(gameId);
      toast.success('Left game successfully!', { duration: 5000 });
      onLeave();
    } catch (error) {
      console.error('Error leaving game:', error);
      toast.error('Failed to leave game');
      setIsLeaving(false);
    }
  };

  const renderPlayerStats = (position: PlayerPosition) => {
    if (!position.info) return null;

    return (
      <div className="mt-2 text-xs space-y-1">
        {position.info.hasPeeked && (
          <div className="flex items-center gap-1 text-blue-400">
            <Eye className="w-3 h-3" />
            <span>Peeked</span>
          </div>
        )}
        {position.info.hasSwappedCard && (
          <div className="flex items-center gap-1 text-purple-400">
            <RefreshCw className="w-3 h-3" />
            <span>Swapped</span>
          </div>
        )}
        {position.info.currentBet > 0 && (
          <div className="flex items-center gap-1 text-yellow-400">
            <Coins className="w-3 h-3" />
            <span>Bet: {position.info.currentBet}</span>
          </div>
        )}
        {position.info.hasFolded && (
          <div className="flex items-center gap-1 text-red-400">
            <X className="w-3 h-3" />
            <span>Folded</span>
          </div>
        )}
      </div>
    );
  };

  const renderCard = (position: PlayerPosition) => {
    const isCurrentPlayer = position.address?.toLowerCase() === playerAddress.toLowerCase();
    const shouldShowCard = showdown || (isCurrentPlayer && position.info?.hasPeeked && position.card);

    return (
      <AnimatePresence>
        <motion.div
          className={`relative w-20 h-28 rounded-lg shadow-xl ${
            position.isWinner ? 'ring-4 ring-yellow-400' : ''
          } ${position.hasFolded ? 'opacity-50' : ''}`}
          initial={false}
          animate={{
            scale: position.showSwapAnimation ? [1, 0.8, 1.2, 1] : 1,
            transition: {
              scale: position.showSwapAnimation ? { 
                duration: 0.5,
                times: [0, 0.4, 0.7, 1]
              } : undefined
            }
          }}
        >
          <div className={`absolute inset-0 rounded-lg ${
            shouldShowCard ? 'bg-white' : 'bg-gradient-to-br from-gray-700 to-gray-800'
          } flex items-center justify-center`}>
            {shouldShowCard ? (
              <div className={`text-2xl font-bold ${
                position.card?.suit === 1 || position.card?.suit === 2 ? 'text-red-600' : 'text-black'
              }`}>
                {position.card && `${CARD_VALUES[position.card.value] || '?'}${CARD_SUITS[position.card.suit] || ''}`}
              </div>
            ) : (
              <div className="w-12 h-12 rounded-full border-2 border-gray-600/30" />
            )}
            {position.hasFolded && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-lg">
                <X className="w-8 h-8 text-white/80" />
              </div>
            )}
          </div>
        </motion.div>
      </AnimatePresence>
    );
  };

  const renderGameActions = () => {
    if (!gameInfo) return null;

    const playerInfo = positions.find(p => p.address === playerAddress)?.info;
    if (!playerInfo) return null;

    switch (gameInfo.state) {
      case GameState.PRE_GAME:
        if (gameInfo.creator === playerAddress) {
          return (
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={handleStartGame}
              disabled={isStarting || gameInfo.playerCount < 2}
              className="px-6 py-3 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-semibold shadow-lg"
            >
              {isStarting ? 'Starting...' : 'Start Game'}
            </motion.button>
          );
        }
        return <p className="text-gray-400 text-lg">Waiting for creator to start the game...</p>;

      case GameState.PEEK_PHASE:
        return (
          <div className="flex gap-4">
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={handlePeekCard}
              disabled={isPeeking || playerInfo.hasPeeked || playerInfo.hasSwappedCard}
              className="flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-semibold shadow-lg"
            >
              <Eye className="w-5 h-5" />
              {isPeeking ? 'Peeking...' : 'Peek Card (5 chips)'}
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={handleSwapCard}
              disabled={isSwapping || !playerInfo.hasPeeked || playerInfo.hasSwappedCard}
              className="flex items-center gap-2 px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-semibold shadow-lg"
            >
              <RefreshCw className="w-5 h-5" />
              {isSwapping ? 'Swapping...' : 'Swap Card (7 chips)'}
            </motion.button>
          </div>
        );

      case GameState.BETTING_PHASE:
        return (
          <div className="flex gap-4 items-center">
            <div className="flex items-center gap-2">
              <div className="relative">
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={betAmount}
                  onChange={(e) => {
                    const value = e.target.value.replace(/[^0-9]/g, '');
                    setBetAmount(value || '1');
                  }}
                  className="w-24 px-3 py-3 bg-gray-700 rounded-lg text-white text-center font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <Coins className="absolute right-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              </div>
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={handlePlaceBet}
                disabled={
                  isBetting || 
                  playerInfo.hasFolded || 
                  !betAmount || 
                  parseInt(betAmount) < 1 || 
                  parseInt(betAmount) > playerInfo.chipBalance ||
                  hasPlacedBet
                }
                className="px-6 py-3 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-semibold shadow-lg"
              >
                {isBetting ? 'Betting...' : 'Place Bet'}
              </motion.button>
            </div>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={handleFold}
              disabled={isFolding || playerInfo.hasFolded}
              className="flex items-center gap-2 px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-semibold shadow-lg"
            >
              <X className="w-5 h-5" />
              {isFolding ? 'Folding...' : 'Fold'}
            </motion.button>
          </div>
        );

      case GameState.SHOWDOWN:
      case GameState.ENDED:
        return (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-3 px-6 py-4 bg-yellow-500/20 rounded-lg"
          >
            <Trophy className="w-8 h-8 text-yellow-400" />
            <span className="text-xl font-bold text-yellow-400">
              Winner: {winner ? `${winner.slice(0, 6)}...${winner.slice(-4)}` : 'Determining...'}
            </span>
            {gameInfo.potAmount > 0 && (
              <span className="ml-2 flex items-center gap-1">
                <Coins className="w-5 h-5 text-yellow-400" />
                <span className="text-lg font-bold text-yellow-400">{gameInfo.potAmount} chips</span>
              </span>
            )}
          </motion.div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h2 className="text-2xl font-bold mb-2">Game #{gameId}</h2>
          {gameInfo && (
            <div className="flex gap-6 text-gray-300">
              <span className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-emerald-500" />
                Phase: {GameState[gameInfo.state]}
              </span>
              {remainingTime !== null && gameInfo.state !== GameState.PRE_GAME && gameInfo.state !== GameState.SHOWDOWN && (
                <span className="flex items-center gap-2 text-yellow-400">
                  <Timer className="w-4 h-4" />
                  <span className="font-medium">{Math.floor(remainingTime / 60)}:{(remainingTime % 60).toString().padStart(2, '0')}</span>
                </span>
              )}
              <span className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-blue-500" />
                Players: {gameInfo.playerCount}
              </span>
              <span className="flex items-center gap-2">
                <Coins className="w-4 h-4 text-yellow-400" />
                Pot: {gameInfo.potAmount} chips
              </span>
              {gameInfo.currentBet > 0 && (
                <span className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-yellow-500" />
                  Current Bet: {gameInfo.currentBet} chips
                </span>
              )}
            </div>
          )}
        </div>
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={handleLeaveGame}
          disabled={isLeaving}
          className="px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLeaving ? 'Leaving...' : 'Leave Game'}
        </motion.button>
      </div>

      <div className="relative aspect-[2/1] rounded-[100px] mb-12 overflow-hidden">
        <div 
          className="absolute inset-0"
          style={{ 
            background: TABLE_GRADIENT,
            boxShadow: 'inset 0 0 100px rgba(0,0,0,0.3)'
          }}
        />
        
        <div className="absolute inset-4 rounded-[80px] border-4 border-[#2a573a] opacity-30" />

        {gameInfo && gameInfo.potAmount > 0 && (
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="absolute top-8 left-1/2 transform -translate-x-1/2"
          >
            <div className="flex items-center gap-2 px-4 py-2 bg-black/40 backdrop-blur-sm rounded-full">
              <Coins className="w-5 h-5 text-yellow-400" />
              <span className="text-lg font-bold text-yellow-400">
                {gameInfo.potAmount}
              </span>
            </div>
          </motion.div>
        )}

        <div className="absolute inset-0 flex items-center justify-center">
          <div className="grid grid-cols-5 gap-8 w-full max-w-4xl px-8">
            {positions.map((position, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1 }}
                className={`flex flex-col items-center ${
                  position.address 
                    ? 'bg-gray-800/90 backdrop-blur-sm' 
                    : 'bg-gray-800/40'
                } rounded-xl p-4 ${
                  position.isWinner 
                    ? 'ring-2 ring-yellow-400 shadow-[0_0_20px_rgba(234,179,8,0.3)]' 
                    : ''
                } ${
                  position.hasFolded
                    ? 'opacity-50'
                    : ''
                }`}
              >
                {position.address ? (
                  <>
                    {renderCard(position)}
                    <div className="text-center mt-3">
                      <div className="flex items-center gap-2 justify-center">
                        <p className="text-sm font-medium">
                          {position.address.slice(0, 4)}...{position.address.slice(-4)}
                        </p>
                        {position.isWinner && (
                          <Trophy className="w-4 h-4 text-yellow-400" />
                        )}
                      </div>
                      <motion.div
                        className="flex items-center justify-center gap-1 mt-1"
                        animate={{ scale: position.info?.chipBalance !== positions[index]?.info?.chipBalance ? [1, 1.2, 1] : 1 }}
                      >
                        <Coins className="w-3 h-3 text-yellow-400" />
                        <p className="text-sm text-yellow-400">
                          {position.info?.chipBalance}
                        </p>
                      </motion.div>
                      {renderPlayerStats(position)}
                    </div>
                  </>
                ) : (
                  <div className="w-20 h-28 rounded-lg bg-gray-700/30" />
                )}
              </motion.div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex justify-center">
        {renderGameActions()}
      </div>
    </div>
  );
}