import { firebaseConfig } from "./firebase-config.js";

(() => {
  const STORAGE_KEY = "orbit-kanban-tasks-v1";
  const validStatuses = new Set(["todo", "doing", "done"]);
  const board = document.querySelector(".board");
  const backdrop = document.getElementById("modal-backdrop");
  const form = document.getElementById("task-form");
  const titleInput = document.getElementById("task-title");
  const descriptionInput = document.getElementById("task-description");
  const warning = document.getElementById("storage-warning");
  const submitButton = form.querySelector('[type="submit"]');
  let tasks = loadLocalTasks();
  let backendMode = "connecting";
  let firebaseSdk = null;
  let taskCollection = null;
  let draggedTaskId = null;
  let lastFocusedElement = null;

  function isValidTask(task) {
    return task &&
      typeof task.id === "string" &&
      !task.id.includes("/") &&
      typeof task.title === "string" &&
      task.title.trim().length > 0 &&
      task.title.length <= 100 &&
      typeof task.description === "string" &&
      task.description.length <= 500 &&
      validStatuses.has(task.status) &&
      typeof task.createdAt === "string" &&
      task.createdAt.length <= 40;
  }

  function loadLocalTasks() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === null) return [];
      const parsed = JSON.parse(saved);
      if (!Array.isArray(parsed)) throw new TypeError("Formato de tarefas inválido.");
      return parsed.filter(isValidTask);
    } catch (error) {
      console.error("Não foi possível carregar as tarefas salvas localmente.", error);
      setStatus("Não foi possível ler as tarefas salvas neste navegador.");
      return [];
    }
  }

  function setStatus(message, level = "error") {
    warning.textContent = message;
    warning.classList.toggle("visible", Boolean(message));
    if (message) {
      warning.dataset.level = level;
    } else {
      delete warning.dataset.level;
    }
  }

  function saveLocalTasks() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
    } catch (error) {
      console.error("Não foi possível salvar as tarefas neste navegador.", error);
      setStatus("O navegador não conseguiu salvar as tarefas localmente.");
      throw error;
    }
  }

  function createTaskId() {
    return window.crypto && typeof window.crypto.randomUUID === "function"
      ? window.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function taskPayload(task) {
    return {
      title: task.title,
      description: task.description,
      status: task.status,
      createdAt: task.createdAt
    };
  }

  function requireFirebase() {
    if (backendMode !== "firebase" || !firebaseSdk || !taskCollection) {
      throw new Error("O Firebase ainda não está conectado. Confira a configuração e as permissões.");
    }
  }

  async function createTask(task) {
    if (backendMode === "local") {
      tasks.unshift(task);
      saveLocalTasks();
      render();
      return;
    }

    requireFirebase();
    await firebaseSdk.setDoc(firebaseSdk.doc(taskCollection, task.id), taskPayload(task));
  }

  async function deleteTask(taskId) {
    if (backendMode === "local") {
      tasks = tasks.filter(task => task.id !== taskId);
      saveLocalTasks();
      render();
      return;
    }

    requireFirebase();
    await firebaseSdk.deleteDoc(firebaseSdk.doc(taskCollection, taskId));
  }

  async function moveTask(taskId, status) {
    const task = tasks.find(item => item.id === taskId);
    if (!task || !validStatuses.has(status) || task.status === status) return;

    if (backendMode === "local") {
      task.status = status;
      saveLocalTasks();
      render();
      return;
    }

    requireFirebase();
    await firebaseSdk.updateDoc(firebaseSdk.doc(taskCollection, taskId), { status });
  }

  function reportActionError(action, error) {
    console.error(`${action}:`, error);
    const code = error.code || "";
    const guidanceByCode = {
      "auth/operation-not-allowed": "Ative o provedor Anônimo em Authentication > Método de login no Firebase.",
      "auth/configuration-not-found": "Ative o login anônimo em Authentication > Método de login no Firebase.",
      "auth/unauthorized-domain": "Adicione o domínio atual em Authentication > Configurações > Domínios autorizados.",
      "auth/invalid-api-key": "Confira o apiKey em firebase-config.js e confirme que pertence a este projeto.",
      "auth/network-request-failed": "Verifique sua conexão, VPN ou bloqueio de rede e tente novamente.",
      "permission-denied": "As regras do Firestore negaram o acesso. Publique firestore.rules e confirme o caminho users/{uid}/tasks.",
      "unavailable": "O Firestore está indisponível ou sem conexão. Verifique a rede e tente novamente.",
      "failed-precondition": "Confira se o banco Firestore foi criado e se a consulta exige algum índice."
    };
    const guidance = guidanceByCode[code] ||
      (error.message && /fetch|network|load/i.test(error.message)
        ? "Não foi possível carregar o SDK do Firebase. Verifique a conexão e execute o app por um servidor local, como o Live Server."
        : "Confira a configuração do Firebase, a conexão e as regras publicadas no Firestore.");
    setStatus(`${action}. ${guidance}${code ? ` (código: ${code})` : ""}`, "error");
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

  async function initializeBackend() {
    if (window.location.protocol === "file:") {
      backendMode = "error";
      setStatus("O app foi aberto como arquivo local. Inicie o Live Server no VS Code e abra o endereço http://localhost.", "error");
      return;
    }

    const requiredConfig = ["apiKey", "authDomain", "projectId", "appId"];
    const missingConfig = requiredConfig.filter(key => {
      const value = firebaseConfig[key];
      return typeof value !== "string" || value.trim() === "" || value.startsWith("COLE_");
    });

    if (missingConfig.length > 0) {
      backendMode = "local";
      setStatus(`Modo local: as tarefas ficam somente neste navegador. Preencha no firebase-config.js: ${missingConfig.join(", ")}.`, "local");
      return;
    }

    setStatus("Verificando configuração, login anônimo e acesso ao Firestore...", "loading");

    try {
      const [appSdk, authSdk, firestoreSdk] = await Promise.all([
        import("https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js"),
        import("https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js"),
        import("https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js")
      ]);

      const app = appSdk.initializeApp(firebaseConfig);
      const auth = authSdk.getAuth(app);
      const database = firestoreSdk.getFirestore(app);
      const { user } = await authSdk.signInAnonymously(auth);

      firebaseSdk = firestoreSdk;
      taskCollection = firestoreSdk.collection(database, "users", user.uid, "tasks");

      const existingTasks = await firestoreSdk.getDocs(taskCollection);
      const existingTaskIds = new Set(existingTasks.docs.map(document => document.id));
      const localTasksToMigrate = tasks.filter(task => isValidTask(task) && !existingTaskIds.has(task.id));
      if (localTasksToMigrate.length > 0) {
        for (const task of localTasksToMigrate) {
          await firestoreSdk.setDoc(
            firestoreSdk.doc(taskCollection, task.id),
            taskPayload(task)
          );
        }
      }

      backendMode = "firebase";
      setStatus("Firebase conectado. Tarefas sincronizadas com a nuvem.", "success");
      firebaseSdk.onSnapshot(
        firebaseSdk.query(taskCollection, firebaseSdk.orderBy("createdAt", "desc")),
        snapshot => {
          tasks = snapshot.docs
            .map(document => ({ id: document.id, ...document.data() }))
            .filter(isValidTask);
          render();
          setStatus("Firebase conectado. Tarefas sincronizadas com a nuvem.", "success");
        },
        error => {
          backendMode = "error";
          reportActionError("Falha ao sincronizar com o Firestore", error);
        }
      );
    } catch (error) {
      backendMode = "error";
      reportActionError(
        "Não foi possível conectar ao Firebase. Confira o firebase-config.js, o login anônimo e as regras do Firestore",
        error
      );
    }
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

  form.addEventListener("submit", async event => {
    event.preventDefault();
    const title = titleInput.value.trim();
    if (!title) {
      titleInput.focus();
      return;
    }

    submitButton.disabled = true;
    try {
      await createTask({
        id: createTaskId(),
        title,
        description: descriptionInput.value.trim(),
        status: "todo",
        createdAt: new Date().toISOString()
      });
      closeModal();
    } catch (error) {
      reportActionError("Não foi possível criar a tarefa", error);
    } finally {
      submitButton.disabled = false;
    }
  });

  board.addEventListener("click", async event => {
    const deleteButton = event.target.closest(".delete-button");
    if (!deleteButton) return;
    const card = deleteButton.closest(".task-card");
    try {
      await deleteTask(card.dataset.taskId);
    } catch (error) {
      reportActionError("Não foi possível excluir a tarefa", error);
    }
  });

  board.addEventListener("keydown", async event => {
    const card = event.target.closest(".task-card");
    if (!card || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
    event.preventDefault();
    const statusOrder = ["todo", "doing", "done"];
    const currentTask = tasks.find(task => task.id === card.dataset.taskId);
    if (!currentTask) return;
    const nextIndex = statusOrder.indexOf(currentTask.status) + (event.key === "ArrowRight" ? 1 : -1);
    if (nextIndex < 0 || nextIndex >= statusOrder.length) return;

    try {
      await moveTask(currentTask.id, statusOrder[nextIndex]);
      if (backendMode === "local") {
        const updatedCard = board.querySelector(`[data-task-id="${CSS.escape(currentTask.id)}"]`);
        if (updatedCard) updatedCard.focus();
      }
    } catch (error) {
      reportActionError("Não foi possível mover a tarefa", error);
    }
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
    column.addEventListener("drop", async event => {
      event.preventDefault();
      column.classList.remove("drag-over");
      const taskId = event.dataTransfer.getData("text/plain") || draggedTaskId;
      try {
        await moveTask(taskId, column.dataset.status);
      } catch (error) {
        reportActionError("Não foi possível mover a tarefa", error);
      }
    });
  });

  render();
  initializeBackend();
})();
