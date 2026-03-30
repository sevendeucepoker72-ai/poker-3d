import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom', 'zustand'],
  },
  build: {
    rollupOptions: {
      output: {
        // rolldown (Vite 8) requires manualChunks as a function
        manualChunks(id) {
          if (id.includes('node_modules/three') || id.includes('@react-three')) {
            return 'vendor-three';
          }
          if (id.includes('node_modules/socket.io-client') || id.includes('node_modules/engine.io-client')) {
            return 'vendor-socket';
          }
          if (id.includes('node_modules/zustand')) {
            return 'vendor-store';
          }
          if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/')) {
            return 'vendor-react';
          }
          // Lazy-loaded game overlays — split into own chunk, loaded on first open
          const OVERLAY_COMPONENTS = [
            'TimingTellTracker', 'TableCommentary', 'RangeVisualizer', 'SpectatorPredict',
            'PauseCoach', 'StreamOverlay', 'GTOSolver', 'CoachingRail', 'SessionRecap',
            'PredictionMarket', 'HandHeatmap', 'GTOOverlay', 'PostHandCoach', 'VoiceChat',
            'ProvablyFair', 'ShareReplay', 'EquityCalculator', 'HandReplayViewer', 'HotkeySettings',
          ];
          if (OVERLAY_COMPONENTS.some(name =>
            id.includes(`/ui/${name}`) || id.includes(`/game/${name}`) || id.includes(`/replay/${name}`)
          )) {
            return 'game-overlays';
          }
          // Lobby-only features — not needed at the table
          const LOBBY_COMPONENTS = [
            'AdvancedAnalytics', 'StakingMarketplace', 'TournamentBracket', 'TournamentDirector',
            'HandHistoryImporter', 'MultiTableView', 'SocialBracket', 'BankrollAI',
            'PlayerProfile', 'NFTBadges',
          ];
          if (LOBBY_COMPONENTS.some(name => id.includes(`/ui/${name}`))) {
            return 'lobby-features';
          }
        },
      },
    },
    chunkSizeWarningLimit: 800,
  },
})
