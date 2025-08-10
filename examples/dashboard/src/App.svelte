<script lang="ts">
  import { initializeJotDB, useCollection, useConnectionStatus, z } from '@jotdb/svelte';
  import { onMount } from 'svelte';
  
  // Initialize JotDB client
  initializeJotDB({
    endpoint: 'https://your-jotdb-worker.your-subdomain.workers.dev',
    enableRealtime: true
  });

  // Metrics schema
  const MetricSchema = z.object({
    id: z.string(),
    name: z.string(),
    value: z.number(),
    unit: z.string(),
    timestamp: z.number(),
    category: z.enum(['performance', 'users', 'revenue', 'system'])
  });

  // Event schema for real-time activity feed
  const EventSchema = z.object({
    id: z.string(),
    type: z.enum(['user_signup', 'purchase', 'error', 'deployment']),
    message: z.string(),
    timestamp: z.number(),
    severity: z.enum(['info', 'warning', 'error', 'success'])
  });

  type Metric = z.infer<typeof MetricSchema>;
  type Event = z.infer<typeof EventSchema>;

  // Real-time data
  const metrics = useCollection<Metric>('metrics', MetricSchema);
  const events = useCollection<Event>('events', EventSchema);
  const connectionStatus = useConnectionStatus();

  // Computed metrics by category
  $: performanceMetrics = $metrics.filter(m => m.category === 'performance');
  $: userMetrics = $metrics.filter(m => m.category === 'users');
  $: revenueMetrics = $metrics.filter(m => m.category === 'revenue');
  $: systemMetrics = $metrics.filter(m => m.category === 'system');

  // Recent events (last 10)
  $: recentEvents = $events
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 10);

  // Simulate real-time data updates
  onMount(() => {
    const interval = setInterval(async () => {
      // Simulate updating metrics
      const randomMetrics = [
        { name: 'Response Time', category: 'performance', unit: 'ms', value: Math.floor(Math.random() * 100) + 50 },
        { name: 'Active Users', category: 'users', unit: 'users', value: Math.floor(Math.random() * 1000) + 500 },
        { name: 'Revenue Today', category: 'revenue', unit: '$', value: Math.floor(Math.random() * 10000) + 5000 },
        { name: 'CPU Usage', category: 'system', unit: '%', value: Math.floor(Math.random() * 50) + 20 }
      ];

      const randomMetric = randomMetrics[Math.floor(Math.random() * randomMetrics.length)];
      
      await metrics.add({
        id: crypto.randomUUID(),
        name: randomMetric.name,
        value: randomMetric.value,
        unit: randomMetric.unit,
        category: randomMetric.category as any,
        timestamp: Date.now()
      });

      // Occasionally add events
      if (Math.random() > 0.7) {
        const eventTypes = [
          { type: 'user_signup', message: 'New user registered', severity: 'success' },
          { type: 'purchase', message: 'Order completed', severity: 'success' },
          { type: 'error', message: 'API error detected', severity: 'error' },
          { type: 'deployment', message: 'New version deployed', severity: 'info' }
        ];

        const randomEvent = eventTypes[Math.floor(Math.random() * eventTypes.length)];
        
        await events.add({
          id: crypto.randomUUID(),
          type: randomEvent.type as any,
          message: randomEvent.message,
          severity: randomEvent.severity as any,
          timestamp: Date.now()
        });
      }
    }, 3000);

    return () => clearInterval(interval);
  });

  function getLatestMetric(metricName: string, metricsList: Metric[]): Metric | null {
    return metricsList
      .filter(m => m.name === metricName)
      .sort((a, b) => b.timestamp - a.timestamp)[0] || null;
  }

  function formatValue(value: number, unit: string): string {
    if (unit === '$') {
      return `$${value.toLocaleString()}`;
    }
    return `${value}${unit}`;
  }

  function formatTime(timestamp: number): string {
    return new Date(timestamp).toLocaleTimeString();
  }
</script>

<main>
  <header class="dashboard-header">
    <h1>JotDB Live Dashboard</h1>
    <p>Real-time metrics and analytics powered by JotDB v2</p>
    <div class="connection-indicator status-{$connectionStatus}">
      <div class="indicator"></div>
      <span>{$connectionStatus}</span>
    </div>
  </header>

  <div class="dashboard-grid">
    <!-- Performance Metrics -->
    <section class="metric-card performance">
      <h2>Performance</h2>
      <div class="metric-value">
        {#if getLatestMetric('Response Time', performanceMetrics)}
          {@const metric = getLatestMetric('Response Time', performanceMetrics)}
          <span class="value">{metric.value}</span>
          <span class="unit">{metric.unit}</span>
          <div class="timestamp">Updated {formatTime(metric.timestamp)}</div>
        {:else}
          <span class="value">--</span>
          <span class="unit">ms</span>
        {/if}
      </div>
    </section>

    <!-- User Metrics -->
    <section class="metric-card users">
      <h2>Active Users</h2>
      <div class="metric-value">
        {#if getLatestMetric('Active Users', userMetrics)}
          {@const metric = getLatestMetric('Active Users', userMetrics)}
          <span class="value">{metric.value.toLocaleString()}</span>
          <span class="unit">{metric.unit}</span>
          <div class="timestamp">Updated {formatTime(metric.timestamp)}</div>
        {:else}
          <span class="value">--</span>
          <span class="unit">users</span>
        {/if}
      </div>
    </section>

    <!-- Revenue Metrics -->
    <section class="metric-card revenue">
      <h2>Revenue Today</h2>
      <div class="metric-value">
        {#if getLatestMetric('Revenue Today', revenueMetrics)}
          {@const metric = getLatestMetric('Revenue Today', revenueMetrics)}
          <span class="value">${metric.value.toLocaleString()}</span>
          <div class="timestamp">Updated {formatTime(metric.timestamp)}</div>
        {:else}
          <span class="value">$--</span>
        {/if}
      </div>
    </section>

    <!-- System Metrics -->
    <section class="metric-card system">
      <h2>CPU Usage</h2>
      <div class="metric-value">
        {#if getLatestMetric('CPU Usage', systemMetrics)}
          {@const metric = getLatestMetric('CPU Usage', systemMetrics)}
          <span class="value">{metric.value}</span>
          <span class="unit">%</span>
          <div class="timestamp">Updated {formatTime(metric.timestamp)}</div>
        {:else}
          <span class="value">--</span>
          <span class="unit">%</span>
        {/if}
      </div>
    </section>

    <!-- Activity Feed -->
    <section class="activity-feed">
      <h2>Live Activity</h2>
      <div class="events-list">
        {#each recentEvents as event (event.id)}
          <div class="event severity-{event.severity}">
            <div class="event-type">{event.type.replace('_', ' ')}</div>
            <div class="event-message">{event.message}</div>
            <div class="event-time">{formatTime(event.timestamp)}</div>
          </div>
        {:else}
          <div class="no-events">No recent activity</div>
        {/each}
      </div>
    </section>

    <!-- Metrics History -->
    <section class="metrics-history">
      <h2>All Metrics ({$metrics.length})</h2>
      <div class="metrics-table">
        <div class="table-header">
          <span>Metric</span>
          <span>Value</span>
          <span>Category</span>
          <span>Time</span>
        </div>
        {#each $metrics.slice(-20).reverse() as metric (metric.id)}
          <div class="table-row">
            <span class="metric-name">{metric.name}</span>
            <span class="metric-value">{formatValue(metric.value, metric.unit)}</span>
            <span class="metric-category category-{metric.category}">{metric.category}</span>
            <span class="metric-time">{formatTime(metric.timestamp)}</span>
          </div>
        {/each}
      </div>
    </section>
  </div>
</main>

<style>
  :global(body) {
    margin: 0;
    padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #f1f5f9;
    color: #334155;
  }

  main {
    min-height: 100vh;
    padding: 2rem;
  }

  .dashboard-header {
    text-align: center;
    margin-bottom: 3rem;
  }

  .dashboard-header h1 {
    font-size: 3rem;
    font-weight: 700;
    color: #1e293b;
    margin-bottom: 0.5rem;
  }

  .dashboard-header p {
    color: #64748b;
    font-size: 1.2rem;
    margin-bottom: 1rem;
  }

  .connection-indicator {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 1rem;
    background: white;
    border-radius: 20px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    font-size: 0.9rem;
    font-weight: 500;
  }

  .indicator {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    animation: pulse 2s infinite;
  }

  .status-connected .indicator {
    background: #10b981;
  }

  .status-disconnected .indicator {
    background: #ef4444;
  }

  .status-connecting .indicator {
    background: #f59e0b;
  }

  .dashboard-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 2rem;
    max-width: 1400px;
    margin: 0 auto;
  }

  .metric-card {
    background: white;
    padding: 2rem;
    border-radius: 16px;
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
    text-align: center;
    position: relative;
    overflow: hidden;
  }

  .metric-card::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 4px;
  }

  .metric-card.performance::before {
    background: #3b82f6;
  }

  .metric-card.users::before {
    background: #10b981;
  }

  .metric-card.revenue::before {
    background: #f59e0b;
  }

  .metric-card.system::before {
    background: #ef4444;
  }

  .metric-card h2 {
    font-size: 1.1rem;
    color: #64748b;
    margin-bottom: 1rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .metric-value .value {
    font-size: 3rem;
    font-weight: 700;
    color: #1e293b;
    display: block;
  }

  .metric-value .unit {
    font-size: 1.2rem;
    color: #64748b;
    margin-left: 0.5rem;
  }

  .timestamp {
    font-size: 0.8rem;
    color: #94a3b8;
    margin-top: 0.5rem;
  }

  .activity-feed {
    grid-column: 1 / -1;
    background: white;
    padding: 2rem;
    border-radius: 16px;
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
  }

  .activity-feed h2 {
    font-size: 1.5rem;
    color: #1e293b;
    margin-bottom: 1.5rem;
  }

  .events-list {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    max-height: 400px;
    overflow-y: auto;
  }

  .event {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 1rem;
    padding: 1rem;
    border-radius: 8px;
    align-items: center;
  }

  .event.severity-info {
    background: #eff6ff;
    border-left: 4px solid #3b82f6;
  }

  .event.severity-success {
    background: #f0fdf4;
    border-left: 4px solid #10b981;
  }

  .event.severity-warning {
    background: #fffbeb;
    border-left: 4px solid #f59e0b;
  }

  .event.severity-error {
    background: #fef2f2;
    border-left: 4px solid #ef4444;
  }

  .event-type {
    font-weight: 600;
    text-transform: capitalize;
    font-size: 0.9rem;
  }

  .event-message {
    color: #64748b;
  }

  .event-time {
    font-size: 0.8rem;
    color: #94a3b8;
  }

  .no-events {
    text-align: center;
    color: #94a3b8;
    font-style: italic;
    padding: 2rem;
  }

  .metrics-history {
    grid-column: 1 / -1;
    background: white;
    padding: 2rem;
    border-radius: 16px;
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
  }

  .metrics-history h2 {
    font-size: 1.5rem;
    color: #1e293b;
    margin-bottom: 1.5rem;
  }

  .metrics-table {
    display: grid;
    grid-template-columns: 2fr 1fr 1fr 1fr;
    gap: 0.5rem;
  }

  .table-header {
    display: contents;
    font-weight: 600;
    color: #64748b;
    font-size: 0.9rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .table-header span {
    padding: 1rem 0.5rem;
    border-bottom: 2px solid #e2e8f0;
  }

  .table-row {
    display: contents;
  }

  .table-row span {
    padding: 1rem 0.5rem;
    border-bottom: 1px solid #f1f5f9;
    align-items: center;
  }

  .metric-name {
    font-weight: 500;
  }

  .metric-category {
    font-size: 0.8rem;
    padding: 0.25rem 0.5rem;
    border-radius: 12px;
    text-align: center;
    text-transform: capitalize;
  }

  .category-performance {
    background: #dbeafe;
    color: #1e40af;
  }

  .category-users {
    background: #d1fae5;
    color: #065f46;
  }

  .category-revenue {
    background: #fef3c7;
    color: #92400e;
  }

  .category-system {
    background: #fee2e2;
    color: #991b1b;
  }

  .metric-time {
    font-size: 0.8rem;
    color: #94a3b8;
  }

  @keyframes pulse {
    0%, 100% {
      opacity: 1;
    }
    50% {
      opacity: 0.5;
    }
  }

  @media (max-width: 768px) {
    .dashboard-grid {
      grid-template-columns: 1fr;
    }
    
    .metrics-table {
      grid-template-columns: 1fr;
      gap: 1rem;
    }
    
    .table-header span,
    .table-row span {
      padding: 0.5rem;
      display: block;
    }
    
    .table-row {
      display: block;
      background: #f8fafc;
      padding: 1rem;
      border-radius: 8px;
      margin-bottom: 0.5rem;
    }
  }
</style>