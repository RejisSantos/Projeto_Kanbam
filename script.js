(() => {
      const STORAGE_KEY = "orbit-kanban-tasks-v1";
      const validStatuses = new Set(["todo", "doing", "done"]);
      const board = document.querySelector(".board");
      const backdrop = document.getElementById("modal-backdrop");
      const form = document.getElementById("task-form");
      const titleInput = document.getElementById("task-title");
      const descriptionInput = document.getElementById("task-description");
      const warning = document.getElementById("storage-warning");
      let tasks = loadTasks();
      let draggedTaskId = null;
      let lastFocusedElement = null;

      function loadTasks() {
        try {
          const saved = localStorage.getItem(STORAGE_KEY);
          if (saved === null) return [];
          const parsed = JSON.parse(saved);
          if (!Array.isArray(parsed)) throw new TypeError("Formato de tarefas inválido.");
          return parsed.filter(task =>
            task && typeof task.id === "string" &&
            typeof task.title === "string" &&
            typeof task.description === "string" &&
            validStatuses.has(task.status) &&
            typeof task.createdAt === "string"
          );
        } catch (error) {
          console.error("Não foi possível carregar as tarefas salvas.", error);
          warning.classList.add("visible");
          return [];
        }
      }

      function saveTasks() {
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
          warning.classList.remove("visible");
        } catch (error) {
          console.error("Não foi possível salvar as tarefas.", error);
          warning.classList.add("visible");
        }
      }

      function escapeHTML(value) {
        return value.replace(/[&<>"']/g, character => ({
          "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
        })[character]);
      }

      function render() {
        document.querySelectorAll(".column").forEach(column => {
          const status = column.dataset.status;
          const list = column.querySelector(".card-list");
          const columnTasks = tasks.filter(task => task.status === status);
          const count = column.querySelector(".count");
          count.textContent = columnTasks.length;
          count.setAttribute("aria-label", `${columnTasks.length} ${columnTasks.length === 1 ? "tarefa" : "tarefas"}`);
          list.innerHTML = "";

          if (columnTasks.length === 0) {
            const empty = document.createElement("p");
            empty.className = "empty-state";
            empty.textContent = "Nenhuma tarefa por aqui";
            list.appendChild(empty);
            return;
          }

          columnTasks.forEach(task => {
            const card = document.createElement("article");
            card.className = "task-card";
            card.dataset.taskId = task.id;
            card.draggable = true;
            card.tabIndex = 0;
            card.setAttribute("role", "listitem");
            card.setAttribute("aria-label", `${task.title}. Use as setas esquerda e direita para mover entre colunas.`);
            const date = new Date(task.createdAt);
            const formattedDate = Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "short" }).format(date);
            card.innerHTML = `
              <div class="card-top">
                <h3 class="task-title">${escapeHTML(task.title)}</h3>
                <button class="delete-button" type="button" aria-label="Excluir tarefa: ${escapeHTML(task.title)}">
                  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 7h16M10 11v6m4-6v6M6 7l1 14h10l1-14M9 7V4h6v3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
                </button>
              </div>
              ${task.description ? `<p class="task-description">${escapeHTML(task.description)}</p>` : ""}
              <div class="card-footer"><span class="task-label">Tarefa</span>${formattedDate ? `<time class="task-date" datetime="${escapeHTML(task.createdAt)}">${escapeHTML(formattedDate)}</time>` : ""}</div>
            `;
            list.appendChild(card);
          });
        });
      }

      function openModal() {
        lastFocusedElement = document.activeElement;
        backdrop.classList.add("open");
        backdrop.setAttribute("aria-hidden", "false");
        titleInput.focus();
      }

      function closeModal() {
        backdrop.classList.remove("open");
        backdrop.setAttribute("aria-hidden", "true");
        form.reset();
        if (lastFocusedElement) lastFocusedElement.focus();
      }

      document.getElementById("open-modal").addEventListener("click", openModal);
      document.getElementById("close-modal").addEventListener("click", closeModal);
      document.getElementById("cancel-modal").addEventListener("click", closeModal);
      backdrop.addEventListener("click", event => {
        if (event.target === backdrop) closeModal();
      });

      document.addEventListener("keydown", event => {
        if (event.key === "Escape" && backdrop.classList.contains("open")) closeModal();
      });

      form.addEventListener("submit", event => {
        event.preventDefault();
        const title = titleInput.value.trim();
        if (!title) {
          titleInput.focus();
          return;
        }
        tasks.unshift({
          id: window.crypto && typeof window.crypto.randomUUID === "function"
            ? window.crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          title,
          description: descriptionInput.value.trim(),
          status: "todo",
          createdAt: new Date().toISOString()
        });
        saveTasks();
        render();
        closeModal();
      });

      board.addEventListener("click", event => {
        const deleteButton = event.target.closest(".delete-button");
        if (!deleteButton) return;
        const card = deleteButton.closest(".task-card");
        tasks = tasks.filter(task => task.id !== card.dataset.taskId);
        saveTasks();
        render();
      });

      board.addEventListener("keydown", event => {
        const card = event.target.closest(".task-card");
        if (!card || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
        event.preventDefault();
        const statusOrder = ["todo", "doing", "done"];
        const currentTask = tasks.find(task => task.id === card.dataset.taskId);
        const currentIndex = statusOrder.indexOf(currentTask.status);
        const nextIndex = currentIndex + (event.key === "ArrowRight" ? 1 : -1);
        if (nextIndex < 0 || nextIndex >= statusOrder.length) return;
        currentTask.status = statusOrder[nextIndex];
        saveTasks();
        render();
        const updatedCard = board.querySelector(`[data-task-id="${CSS.escape(currentTask.id)}"]`);
        if (updatedCard) updatedCard.focus();
      });

      board.addEventListener("dragstart", event => {
        const card = event.target.closest(".task-card");
        if (!card) return;
        draggedTaskId = card.dataset.taskId;
        card.classList.add("dragging");
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", draggedTaskId);
      });

      board.addEventListener("dragend", event => {
        const card = event.target.closest(".task-card");
        if (card) card.classList.remove("dragging");
        document.querySelectorAll(".column.drag-over").forEach(column => column.classList.remove("drag-over"));
        draggedTaskId = null;
      });

      document.querySelectorAll(".column").forEach(column => {
        column.addEventListener("dragover", event => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          column.classList.add("drag-over");
        });
        column.addEventListener("dragleave", event => {
          if (!column.contains(event.relatedTarget)) column.classList.remove("drag-over");
        });
        column.addEventListener("drop", event => {
          event.preventDefault();
          column.classList.remove("drag-over");
          const taskId = event.dataTransfer.getData("text/plain") || draggedTaskId;
          const task = tasks.find(item => item.id === taskId);
          if (!task || !validStatuses.has(column.dataset.status)) return;
          task.status = column.dataset.status;
          saveTasks();
          render();
        });
      });

      render();
    })();
