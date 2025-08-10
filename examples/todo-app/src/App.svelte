<script lang="ts">
  import { initializeJotDB, useCollection, useConnectionStatus, z } from '@jotdb/svelte';
  import TodoItem from './TodoItem.svelte';
  import AddTodo from './AddTodo.svelte';
  import ConnectionStatus from './ConnectionStatus.svelte';

  // Initialize JotDB client
  const client = initializeJotDB({
    endpoint: 'https://your-jotdb-worker.your-subdomain.workers.dev',
    enableRealtime: true
  });

  // Define Todo schema with Zod
  const TodoSchema = z.object({
    id: z.string(),
    text: z.string().min(1),
    completed: z.boolean().default(false),
    createdAt: z.number().default(() => Date.now()),
    updatedAt: z.number().default(() => Date.now())
  });

  type Todo = z.infer<typeof TodoSchema>;

  // Use reactive collection store
  const todos = useCollection<Todo>('todos', TodoSchema);
  const connectionStatus = useConnectionStatus();

  // Computed values
  $: completedCount = $todos.filter(todo => todo.completed).length;
  $: totalCount = $todos.length;
  $: pendingCount = totalCount - completedCount;

  async function addTodo(text: string) {
    const newTodo: Todo = {
      id: crypto.randomUUID(),
      text,
      completed: false,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    
    await todos.add(newTodo);
  }

  async function toggleTodo(todo: Todo) {
    const updatedTodo = {
      ...todo,
      completed: !todo.completed,
      updatedAt: Date.now()
    };
    
    // Update through the collection
    const collection = client.collection('todos', TodoSchema);
    await collection.doc(todo.id).set(updatedTodo);
  }

  async function deleteTodo(todo: Todo) {
    const collection = client.collection('todos', TodoSchema);
    await collection.doc(todo.id).delete();
  }

  async function clearCompleted() {
    const collection = client.collection('todos', TodoSchema);
    const completedTodos = $todos.filter(todo => todo.completed);
    
    await Promise.all(
      completedTodos.map(todo => collection.doc(todo.id).delete())
    );
  }
</script>

<main>
  <div class="container">
    <header>
      <h1>JotDB Todo App</h1>
      <p>Real-time collaborative todo list powered by JotDB v2</p>
      <ConnectionStatus status={$connectionStatus} />
    </header>

    <div class="stats">
      <span class="stat">
        <strong>{totalCount}</strong> total
      </span>
      <span class="stat">
        <strong>{pendingCount}</strong> pending
      </span>
      <span class="stat">
        <strong>{completedCount}</strong> completed
      </span>
    </div>

    <AddTodo onAdd={addTodo} />

    <div class="todo-list">
      {#each $todos as todo (todo.id)}
        <TodoItem 
          {todo} 
          onToggle={() => toggleTodo(todo)}
          onDelete={() => deleteTodo(todo)}
        />
      {:else}
        <div class="empty-state">
          <p>No todos yet. Add one above to get started!</p>
        </div>
      {/each}
    </div>

    {#if completedCount > 0}
      <div class="actions">
        <button 
          class="clear-completed"
          on:click={clearCompleted}
        >
          Clear {completedCount} completed
        </button>
      </div>
    {/if}
  </div>
</main>

<style>
  :global(body) {
    margin: 0;
    padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #f8fafc;
    color: #334155;
  }

  .container {
    max-width: 600px;
    margin: 0 auto;
    padding: 2rem;
  }

  header {
    text-align: center;
    margin-bottom: 2rem;
  }

  h1 {
    margin: 0 0 0.5rem 0;
    font-size: 2.5rem;
    font-weight: 700;
    color: #1e293b;
  }

  header p {
    margin: 0 0 1rem 0;
    color: #64748b;
    font-size: 1.1rem;
  }

  .stats {
    display: flex;
    justify-content: center;
    gap: 2rem;
    margin-bottom: 2rem;
    padding: 1rem;
    background: white;
    border-radius: 12px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  }

  .stat {
    text-align: center;
    color: #64748b;
  }

  .stat strong {
    display: block;
    font-size: 1.5rem;
    color: #1e293b;
    margin-bottom: 0.25rem;
  }

  .todo-list {
    background: white;
    border-radius: 12px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    overflow: hidden;
    margin-bottom: 2rem;
  }

  .empty-state {
    padding: 3rem 2rem;
    text-align: center;
    color: #94a3b8;
    font-style: italic;
  }

  .actions {
    text-align: center;
  }

  .clear-completed {
    background: #ef4444;
    color: white;
    border: none;
    padding: 0.75rem 1.5rem;
    border-radius: 8px;
    font-size: 0.9rem;
    font-weight: 500;
    cursor: pointer;
    transition: background-color 0.2s;
  }

  .clear-completed:hover {
    background: #dc2626;
  }
</style>