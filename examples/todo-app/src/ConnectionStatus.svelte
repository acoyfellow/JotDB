<script lang="ts">
  export let status: 'connected' | 'disconnected' | 'connecting';

  $: statusColor = {
    connected: '#10b981',
    disconnected: '#ef4444', 
    connecting: '#f59e0b'
  }[status];

  $: statusText = {
    connected: 'Connected',
    disconnected: 'Disconnected',
    connecting: 'Connecting...'
  }[status];
</script>

<div class="connection-status" style="--status-color: {statusColor}">
  <div class="status-indicator"></div>
  <span class="status-text">{statusText}</span>
</div>

<style>
  .connection-status {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 1rem;
    background: white;
    border-radius: 20px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    font-size: 0.85rem;
    font-weight: 500;
  }

  .status-indicator {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--status-color);
    animation: pulse 2s infinite;
  }

  .status-text {
    color: var(--status-color);
  }

  @keyframes pulse {
    0% {
      opacity: 1;
    }
    50% {
      opacity: 0.5;
    }
    100% {
      opacity: 1;
    }
  }
</style>