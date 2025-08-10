<script lang="ts">
  export let onAdd: (text: string) => Promise<void>;

  let text = '';
  let isAdding = false;

  async function handleSubmit() {
    if (!text.trim() || isAdding) return;
    
    isAdding = true;
    try {
      await onAdd(text.trim());
      text = '';
    } catch (error) {
      console.error('Failed to add todo:', error);
      // You could add error handling UI here
    } finally {
      isAdding = false;
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      handleSubmit();
    }
  }
</script>

<div class="add-todo">
  <div class="input-container">
    <input
      type="text"
      placeholder="What needs to be done?"
      bind:value={text}
      on:keydown={handleKeydown}
      disabled={isAdding}
      class="todo-input"
    />
    <button
      on:click={handleSubmit}
      disabled={!text.trim() || isAdding}
      class="add-btn"
    >
      {isAdding ? '...' : 'Add'}
    </button>
  </div>
</div>

<style>
  .add-todo {
    margin-bottom: 2rem;
  }

  .input-container {
    display: flex;
    gap: 0.75rem;
    background: white;
    padding: 1rem;
    border-radius: 12px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  }

  .todo-input {
    flex: 1;
    border: 2px solid #e2e8f0;
    border-radius: 8px;
    padding: 0.75rem 1rem;
    font-size: 1rem;
    transition: border-color 0.2s;
  }

  .todo-input:focus {
    outline: none;
    border-color: #3b82f6;
  }

  .todo-input:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .add-btn {
    background: #3b82f6;
    color: white;
    border: none;
    border-radius: 8px;
    padding: 0.75rem 1.5rem;
    font-size: 1rem;
    font-weight: 500;
    cursor: pointer;
    transition: background-color 0.2s;
    min-width: 80px;
  }

  .add-btn:hover:not(:disabled) {
    background: #2563eb;
  }

  .add-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
</style>