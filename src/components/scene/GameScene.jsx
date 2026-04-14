import { memo } from 'react';
import PokerTable2D from './PokerTable2D';

const GameScene = memo(function GameScene() {
  return <PokerTable2D />;
});

export default GameScene;
