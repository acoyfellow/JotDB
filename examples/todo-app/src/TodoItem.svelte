<script lang="ts">
  export let todo: {
    id: string;
    text: string;
    completed: boolean;
    createdAt: number;
    updatedAt: number;
  };
  export let onToggle: () => void;
  export let onDelete: () => void;

  function formatTime(timestamp: number): string {
    return new Date(timestamp).toLocaleTimeString();
  }
</script>

<div class="todo-item" class:completed={todo.completed}>
  <label class="checkbox-container">
    <input 
      type="checkbox" 
      checked={todo.completed}
      on:change={onToggle}
    />
    <span class="checkmark"></span>
  </label>
  
  <div class="todo-content">
    <span class="todo-text" class:completed={todo.completed}>
      {todo.text}
    </span>
    <span class="todo-time">
      {#if todo.updatedAt !== todo.createdAt}
        Updated {formatTime(todo.updatedAt)}
      {:else}
        Created {formatTime(todo.createdAt)}
      {/if}
    </span>
  </div>
  
  <button 
    class="delete-btn"
    on:click={onDelete}
    aria-label="Delete todo"
  >
    ×
  </button>
</div>

<style>
  .todo-item {
    display: flex;
    align-items: center;
    padding: 1rem 1.5rem;
    border-bottom: 1px solid #e2e8f0;
    transition: background-color 0.2s;
  }

  .todo-item:hover {
    background: #f8fafc;
  }

  .todo-item:last-child {
    border-bottom: none;
  }

  .todo-item.completed {
    opacity: 0.6;
  }

  .checkbox-container {
    position: relative;
    cursor: pointer;
    margin-right: 1rem;
  }

  .checkbox-container input {
    opacity: 0;
    cursor: pointer;
    height: 0;
    width: 0;
  }

  .checkmark {
    position: absolute;
    top: 0;
    left: 0;
    height: 20px;
    width: 20px;
    background-color: white;
    border: 2px solid #cbd5e1;
    border-radius: 4px;
    transition: all 0.2s;
  }

  .checkbox-container:hover input ~ .checkmark {
    border-color: #3b82f6;
  }

  .checkbox-container input:checked ~ .checkmark {
    background-color: #3b82f6;
    border-color: #3b82f6;
  }

  .checkmark:after {
    content: "";
    position: absolute;
    display: none;
  }

  .checkbox-container input:checked ~ .checkmark:after {
    display: block;
  }

  .checkbox-container .checkmark:after {
    left: 6px;
    top: 2px;
    width: 6px;
    height: 10px;
    border: solid white;
    border-width: 0 2px 2px 0;
    transform: rotate(45deg);
  }

  .todo-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .todo-text {
    font-size: 1rem;
    line-height: 1.5;
    transition: text-decoration 0.2s;
  }

  .todo-text.completed {
    text-decoration: line-through;
    color: #94a3b8;
  }

  .todo-time {
    font-size: 0.8rem;
    color: #94a3b8;
  }

  .delete-btn {
    background: none;
    border: none;
    color: #ef4444;
    font-size: 1.5rem;
    cursor: pointer;
    padding: 0.5rem;
    border-radius: 4px;
    transition: background-color 0.2s;
    line-height: 1;
  }

  .delete-btn:hover {
    background: #fef2f2;
  }
</style>