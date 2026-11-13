import { firebaseConfig } from "./firebase-config.js";
import { getTaskRoute, openTaskPage, recordActivity } from "./task-page.js";

(() => {
  const TASKS_STORAGE_KEY = "orbit-kanban-tasks-v1";
  const TASKS_OWNER_KEY = `${TASKS_STORAGE_KEY}-owner`;
  const validStatuses = new Set(["todo", "doing", "done"]);
  const defaultColumns = [
    { id: "todo", nome: "A Fazer", status: "todo", position: 0 },
    { id: "doing", nome: "Em Andamento", status: "doing", position: 1 },
    { id: "done", nome: "Concluído", status: "done", position: 2 }
  ];

  const board = document.querySelector(".board");
  const taskBackdrop = document.getElementById("modal-backdrop");
  const taskForm = document.getElementById("task-form");
  const taskTitleInput = document.getElementById("task-title");
  const taskDescriptionInput = document.getElementById("task-description");
  const taskSubmitButton = taskForm.querySelector('[type="submit"]');
  const authPanel = document.getElementById("auth-panel");
  const authForm = document.getElementById("auth-form");
  const authEmail = document.getElementById("auth-email");
  const authPassword = document.getElementById("auth-password");
  const passwordVisibilityToggle = document.getElementById("password-visibility-toggle");
  const authName = document.getElementById("auth-name");
  const authNameField = document.getElementById("auth-name-field");
  const authTitle = document.getElementById("auth-title");
  const authDescription = document.getElementById("auth-description");
  const authStatus = document.getElementById("auth-status");
  const authSubmit = document.getElementById("auth-submit");
  const authModeToggle = document.getElementById("auth-mode-toggle");
  const authSwitchLabel = document.getElementById("auth-switch-label");
  const resetPasswordButton = document.getElementById("reset-password");
  const accountControls = document.getElementById("account-controls");
  const accountEmail = document.getElementById("account-email");
  const signOutButton = document.getElementById("sign-out");
  const boardPicker = document.getElementById("board-picker");
  const ownedBoards = document.getElementById("owned-boards");
  const sharedBoards = document.getElementById("shared-boards");
  const boardsWarning = document.getElementById("boards-warning");
  const boardApp = document.getElementById("board-app");
  const boardTitle = document.getElementById("page-title");
  const boardSubtitle = document.getElementById("board-subtitle");
  const addTaskButton = document.getElementById("open-modal");
  const membersButton = document.getElementById("manage-members");
  const boardModalBackdrop = document.getElementById("board-modal-backdrop");
  const boardForm = document.getElementById("board-form");
  const boardNameInput = document.getElementById("board-name");
  const boardFormWarning = document.getElementById("board-form-warning");
  const membersModalBackdrop = document.getElementById("members-modal-backdrop");
  const inviteForm = document.getElementById("invite-form");
  const inviteEmail = document.getElementById("invite-email");
  const inviteRole = document.getElementById("invite-role");
  const inviteWarning = document.getElementById("invite-warning");
  const memberList = document.getElementById("member-list");

  const taskRoute = getTaskRoute(window.location);
  const columnDialog = document.getElementById("column-dialog");
  const columnForm = document.getElementById("column-form");
  let columnBeingEdited = null;
  let stopTaskPage = null;
  let boardMembers = new Map();
  let stopBoardMembers = null;
  let tasks = [];
  let localTasksToMigrate = loadLocalTasks();
  let pendingAnonymousTasks = [];
  let pendingProfileName = "";
  let firebaseSdk = null;
  let authSdk = null;
  let firebaseAuth = null;
  let database = null;
  let currentUser = null;
  let selectedBoard = null;
  let selectedRole = null;
  let columns = defaultColumns;
  let authMode = "login";
  let stopTaskListener = null;
  let stopColumnListener = null;
  let stopMemberListener = null;
  let draggedTaskId = null;
  let lastFocusedElement = null;

  function setAuthStatus(message, level = "error") {
    authStatus.textContent = message;
    authStatus.classList.toggle("visible", Boolean(message));
    if (message) authStatus.dataset.level = level;
    else delete authStatus.dataset.level;
  }

  function setBoardStatus(element, message, level = "error") {
    element.textContent = message;
    element.classList.toggle("visible", Boolean(message));
    if (message) element.dataset.level = level;
    else delete element.dataset.level;
  }

  function loadLocalTasks() {
    try {
      const saved = localStorage.getItem(TASKS_STORAGE_KEY);
      if (saved === null) return [];
      const parsed = JSON.parse(saved);
      if (!Array.isArray(parsed)) throw new TypeError("Formato de tarefas inválido.");
      return parsed.filter(task =>
        task &&
        typeof task.id === "string" &&
        typeof task.title === "string" &&
        task.title.trim().length > 0 &&
        task.title.length <= 100
      );
    } catch (error) {
      console.error("Não foi possível carregar as tarefas salvas localmente.", error);
      setAuthStatus("Não foi possível ler as tarefas antigas salvas neste navegador.", "error");
      return [];
    }
  }

  function setAuthMode(mode) {
    authMode = mode;
    const registering = mode === "register";
    authTitle.textContent = registering ? "Crie sua conta" : "Entre na sua conta";
    authDescription.textContent = registering
      ? "Crie uma conta para acessar seus quadros de qualquer lugar."
      : "Acesse seus quadros com e-mail e senha.";
    authSubmit.textContent = registering ? "Criar conta" : "Entrar";
    authPassword.autocomplete = registering ? "new-password" : "current-password";
    authName.required = registering;
    authNameField.hidden = !registering;
    resetPasswordButton.hidden = registering;
    authSwitchLabel.textContent = registering ? "Já tem uma conta?" : "Ainda não tem uma conta?";
    authModeToggle.textContent = registering ? "Entrar" : "Criar conta";
  }

  function authErrorMessage(error) {
    const messages = {
      "auth/email-already-in-use": "Este e-mail já possui uma conta. Entre com sua senha.",
      "auth/invalid-credential": "E-mail ou senha incorretos.",
      "auth/invalid-email": "Informe um endereço de e-mail válido.",
      "auth/operation-not-allowed": "Ative E-mail/senha em Authentication > Método de login no Firebase.",
      "auth/too-many-requests": "Muitas tentativas. Aguarde um pouco e tente novamente.",
      "auth/unauthorized-domain": "Adicione o domínio atual em Authentication > Configurações > Domínios autorizados.",
      "auth/user-disabled": "Esta conta foi desativada. Fale com quem administra o projeto.",
      "auth/weak-password": "A senha precisa ter pelo menos 6 caracteres.",
      "auth/network-request-failed": "Falha de conexão. Verifique a rede e tente novamente."
    };
    return messages[error.code] || "Não foi possível concluir a autenticação. Confira os dados e tente novamente.";
  }

  function appErrorMessage(error) {
    const code = error.code || "";
    const guidanceByCode = {
      "permission-denied": "As regras do Firestore negaram o acesso. Publique firestore.rules e confirme a sua participação no quadro.",
      "unavailable": "O Firestore está indisponível ou sem conexão. Verifique a rede e tente novamente.",
      "failed-precondition": "Confira se o Firestore foi criado e se a consulta exige algum índice.",
      "auth/operation-not-allowed": "Ative E-mail/senha em Authentication > Método de login no Firebase.",
      "auth/unauthorized-domain": "Adicione o domínio atual em Authentication > Configurações > Domínios autorizados."
    };
    return guidanceByCode[code] || "Confira a conexão, a configuração do Firebase e as regras do Firestore.";
  }

  function reportActionError(action, error, statusElement = document.getElementById("storage-warning")) {
    console.error(`${action}:`, error);
    setBoardStatus(statusElement, `${action}. ${appErrorMessage(error)}${error.code ? ` (código: ${error.code})` : ""}`, "error");
  }

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
      task.createdAt.length <= 40 &&
      task.board_id === selectedBoard.id;
  }

  function taskPayload(task, boardId = selectedBoard.id) {
    return {
      title: task.title,
      description: task.description || "",
      status: validStatuses.has(task.status) ? task.status : "todo",
      createdAt: task.createdAt || new Date().toISOString(),
      board_id: boardId,
      assigneeId: task.assigneeId || null,
      dueDate: task.dueDate || null,
      priority: ["LOW", "MEDIUM", "HIGH"].includes(task.priority) ? task.priority : "MEDIUM",
      labels: Array.isArray(task.labels) ? task.labels : [],
      storyPoints: Number.isInteger(task.storyPoints) ? task.storyPoints : null,
      checklist: Array.isArray(task.checklist) ? task.checklist : []
    };
  }

  function createTaskId() {
    return window.crypto && typeof window.crypto.randomUUID === "function"
      ? window.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[character]);
  }

  function canEditBoard() {
    return selectedRole === "OWNER" || selectedRole === "EDITOR";
  }

  function renderTasks() {
    document.querySelectorAll(".column").forEach(column => {
      const status = column.dataset.status;
      const list = column.querySelector(".card-list");
      const columnTasks = tasks.filter(task => task.status === status);
      const count = column.querySelector(".count");
      count.textContent = columnTasks.length;
      count.setAttribute("aria-label", `${columnTasks.length} ${columnTasks.length === 1 ? "tarefa" : "tarefas"}`);
      const limit = columns.find(item => item.status === status)?.wipLimit;
      const wip = column.querySelector(".wip-status");
      const exceeded = Number.isInteger(limit) && columnTasks.length > limit;
      wip.textContent = Number.isInteger(limit)
        ? `WIP ${columnTasks.length}/${limit}${exceeded ? " · Limite excedido" : ""}`
        : "";
      wip.classList.toggle("wip-exceeded", exceeded);
      column.querySelector(".edit-column").hidden = !canEditBoard();
      list.replaceChildren();

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
        card.draggable = canEditBoard();
        card.tabIndex = canEditBoard() ? 0 : -1;
        card.setAttribute("role", "listitem");
        card.setAttribute(
          "aria-label",
          canEditBoard()
            ? `${task.title}. Use as setas esquerda e direita para mover entre colunas.`
            : `${task.title}. Somente leitura.`
        );
        const date = new Date(task.createdAt);
        const formattedDate = Number.isNaN(date.getTime())
          ? ""
          : new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "short" }).format(date);
        const params = new URLSearchParams({ board: selectedBoard.id });
        const taskUrl = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)
          ? "/?" + new URLSearchParams({ task: task.id, board: selectedBoard.id })
          : `/tasks/${encodeURIComponent(task.id)}?${params}`;
        const assignee = boardMembers.get(task.assigneeId);
        const labels = Array.isArray(task.labels) ? task.labels.filter(label => typeof label === "string") : [];
        const priority = { LOW: "Baixa", MEDIUM: "Média", HIGH: "Alta" }[task.priority] || "Média";
        const dueDate = /^\d{4}-\d{2}-\d{2}$/.test(task.dueDate || "")
          ? task.dueDate.split("-").reverse().join("/") : "";
        card.innerHTML = `
          <div class="card-top">
            <h3 class="task-title"><a href="${escapeHTML(taskUrl)}" target="_blank" rel="noopener">${escapeHTML(task.title)}</a></h3>
            ${canEditBoard() ? `<button class="delete-button" type="button" aria-label="Excluir tarefa: ${escapeHTML(task.title)}">
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 7h16M10 11v6m4-6v6M6 7l1 14h10l1-14M9 7V4h6v3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>` : ""}
          </div>
          ${task.description ? `<p class="task-description">${escapeHTML(task.description)}</p>` : ""}
          <div class="task-meta">
            <span class="task-label">Prioridade ${priority}</span>
            ${dueDate ? `<span class="task-label">Prazo ${dueDate}</span>` : ""}
            ${Number.isInteger(task.storyPoints) ? `<span class="task-label">${task.storyPoints} pts</span>` : ""}
            ${labels.map(label => `<span class="task-label">${escapeHTML(label)}</span>`).join("")}
          </div>
          <div class="card-footer">${assignee ? `<span class="assignee-chip"><span class="assignee-avatar" aria-hidden="true">${escapeHTML(assignee.nome.trim().split(/\s+/).slice(0, 2).map(word => word[0]).join("").toUpperCase())}</span>${escapeHTML(assignee.nome)}</span>` : "<span></span>"}${formattedDate ? `<time class="task-date" datetime="${escapeHTML(task.createdAt)}">${escapeHTML(formattedDate)}</time>` : ""}</div>
        `;
        list.appendChild(card);
      });
    });

    addTaskButton.hidden = !canEditBoard();
    document.querySelectorAll(".column").forEach(column => {
      column.classList.toggle("read-only", !canEditBoard());
    });
  }

  function applyColumns(snapshot) {
    if (snapshot.empty) {
      columns = defaultColumns;
    } else {
      columns = snapshot.docs
        .map(document => ({ id: document.id, ...document.data() }))
        .filter(column => validStatuses.has(column.status))
        .sort((left, right) => left.position - right.position);
      if (columns.length === 0) columns = defaultColumns;
    }

    defaultColumns.forEach(defaultColumn => {
      const column = columns.find(item => item.status === defaultColumn.status) || defaultColumn;
      const section = document.querySelector(`.column[data-status="${column.status}"]`);
      if (!section) return;
      const title = section.querySelector(".column-title");
      title.replaceChildren(title.querySelector(".status-dot"), document.createTextNode(column.nome));
    });
    renderTasks();
  }

  function renderBoardList(boards) {
    ownedBoards.replaceChildren();
    sharedBoards.replaceChildren();
    const myBoards = boards.filter(item => item.dono_id === currentUser.uid);
    const boardsSharedWithMe = boards.filter(item => item.dono_id !== currentUser.uid);

    function appendBoardCards(container, items, emptyMessage) {
      if (items.length === 0) {
        const empty = document.createElement("p");
        empty.className = "empty-board-list";
        empty.textContent = emptyMessage;
        container.appendChild(empty);
        return;
      }

      items.forEach(item => {
        const button = document.createElement("button");
        button.className = "board-card";
        button.type = "button";
        button.dataset.boardId = item.id;
        const name = document.createElement("strong");
        name.textContent = item.nome;
        const detail = document.createElement("span");
        detail.textContent = item.dono_id === currentUser.uid ? "Proprietário" : "Compartilhado com você";
        button.append(name, detail);
        container.appendChild(button);
      });
    }

    appendBoardCards(ownedBoards, myBoards, "Você ainda não criou quadros.");
    appendBoardCards(sharedBoards, boardsSharedWithMe, "Nenhum quadro foi compartilhado com você.");
  }

  async function fetchBoards() {
    const boardsCollection = firebaseSdk.collection(database, "boards");
    const [ownedSnapshot, sharedSnapshot] = await Promise.all([
      firebaseSdk.getDocs(firebaseSdk.query(
        boardsCollection,
        firebaseSdk.where("dono_id", "==", currentUser.uid)
      )),
      firebaseSdk.getDocs(firebaseSdk.query(
        boardsCollection,
        firebaseSdk.where("memberIds", "array-contains", currentUser.uid)
      ))
    ]);
    const uniqueBoards = new Map();
    [...ownedSnapshot.docs, ...sharedSnapshot.docs].forEach(document => {
      uniqueBoards.set(document.id, { id: document.id, ...document.data() });
    });
    return [...uniqueBoards.values()].sort((left, right) => left.nome.localeCompare(right.nome, "pt-BR"));
  }

  async function createBoardRecord(name, user) {
    const batch = firebaseSdk.writeBatch(database);
    const boardRef = firebaseSdk.doc(firebaseSdk.collection(database, "boards"));
    batch.set(boardRef, {
      nome: name,
      dono_id: user.uid,
      memberIds: [user.uid],
      createdAt: new Date().toISOString()
    });

    batch.set(firebaseSdk.doc(boardRef, "members", user.uid), {
      userId: user.uid,
      email: (user.email || "").toLowerCase(),
      nome: user.displayName || user.email || "Proprietário",
      papel: "OWNER"
    });

    defaultColumns.forEach(column => {
      batch.set(firebaseSdk.doc(boardRef, "columns", column.id), {
        nome: column.nome,
        status: column.status,
        position: column.position,
        wipLimit: null,
        board_id: boardRef.id
      });
    });

    await batch.commit();
    return { id: boardRef.id, nome: name, dono_id: user.uid, memberIds: [user.uid] };
  }

  async function copyTasksToBoard(boardInfo, tasksToCopy) {
    if (tasksToCopy.length === 0) return;
    const destination = firebaseSdk.collection(database, "boards", boardInfo.id, "tasks");
    const existing = await firebaseSdk.getDocs(destination);
    const existingIds = new Set(existing.docs.map(document => document.id));
    for (const task of tasksToCopy) {
      if (existingIds.has(task.id)) continue;
      await firebaseSdk.setDoc(
        firebaseSdk.doc(destination, task.id),
        taskPayload(task, boardInfo.id)
      );
    }
  }

  async function migrateLegacyTasks(boardInfo) {
    const legacyCollection = firebaseSdk.collection(database, "users", currentUser.uid, "tasks");
    const snapshot = await firebaseSdk.getDocs(legacyCollection);
    const existing = await firebaseSdk.getDocs(
      firebaseSdk.collection(database, "boards", boardInfo.id, "tasks")
    );
    const existingIds = new Set(existing.docs.map(document => document.id));
    const legacyTasks = snapshot.docs.map(document => ({
      id: document.id,
      ...document.data()
    })).filter(task =>
      typeof task.title === "string" &&
      task.title.trim().length > 0 &&
      task.title.length <= 100
    );
    await copyTasksToBoard(boardInfo, legacyTasks.filter(task => !existingIds.has(task.id)));
  }

  async function migrateLocalTasks(boardInfo) {
    if (localTasksToMigrate.length === 0) return false;
    const previousOwnerId = localStorage.getItem(TASKS_OWNER_KEY);
    if (previousOwnerId && previousOwnerId !== currentUser.uid) {
      localTasksToMigrate = [];
      return false;
    }

    await copyTasksToBoard(boardInfo, localTasksToMigrate);
    localStorage.setItem(TASKS_OWNER_KEY, currentUser.uid);
    localStorage.removeItem(TASKS_STORAGE_KEY);
    localTasksToMigrate = [];
    return true;
  }

  function stopBoardListeners() {
    [stopTaskListener, stopColumnListener, stopMemberListener, stopBoardMembers].forEach(stop => {
      if (stop) stop();
    });
    stopTaskListener = null;
    stopColumnListener = null;
    stopMemberListener = null;
    stopBoardMembers = null;
    boardMembers.clear();
    if (columnDialog.open) columnDialog.close();
  }

  function showBoardPicker(boards) {
    stopBoardListeners();
    selectedBoard = null;
    selectedRole = null;
    tasks = [];
    boardTitle.textContent = "Quadro de tarefas";
    boardPicker.hidden = false;
    boardApp.hidden = true;
    authPanel.hidden = true;
    setBoardStatus(boardsWarning, "");
    renderBoardList(boards);
  }

  async function initializeSignedInUser(user) {
    currentUser = user;
    accountControls.hidden = false;
    accountEmail.textContent = user.email || "Conta";
    boardPicker.hidden = true;
    boardApp.hidden = true;
    authPanel.hidden = true;
    setBoardStatus(boardsWarning, "");

    const profileName = pendingProfileName || user.displayName || (user.email || "").split("@")[0] || "Usuário";
    pendingProfileName = "";
    const profile = {
      uid: user.uid,
      email: (user.email || "").toLowerCase(),
      nome: profileName,
      updatedAt: new Date().toISOString()
    };
    await firebaseSdk.setDoc(firebaseSdk.doc(database, "users", user.uid), profile, { merge: true });

    if (taskRoute) {
      if (currentUser?.uid !== user.uid) return;
      stopTaskPage = openTaskPage({ sdk: firebaseSdk, db: database, user, route: taskRoute, report: reportActionError });
      return;
    }

    let userBoards = await fetchBoards();
    let owned = userBoards.filter(item => item.dono_id === user.uid);
    const needsPersonalBoard = userBoards.length === 0 ||
      ((pendingAnonymousTasks.length > 0 || localTasksToMigrate.length > 0) && owned.length === 0);

    if (needsPersonalBoard) {
      await createBoardRecord("Meu quadro", { ...user, displayName: profileName });
      userBoards = await fetchBoards();
      owned = userBoards.filter(item => item.dono_id === user.uid);
    }

    const migrationBoard = owned[0];
    if (migrationBoard) {
      await migrateLegacyTasks(migrationBoard);
      const didMigrateLocalTasks = await migrateLocalTasks(migrationBoard);
      if (pendingAnonymousTasks.length > 0) {
        await copyTasksToBoard(migrationBoard, pendingAnonymousTasks);
        pendingAnonymousTasks = [];
      }
      if (didMigrateLocalTasks) {
        setBoardStatus(boardsWarning, "Suas tarefas antigas foram transferidas para o quadro.", "success");
      }
    }

    if (currentUser?.uid !== user.uid) return;
    showBoardPicker(userBoards);
    const linkedBoard = new URLSearchParams(location.search).get("board");
    const match = userBoards.find(item => item.id === linkedBoard);
    if (match) await selectBoard(match);
  }

  async function selectBoard(boardInfo) {
    setBoardStatus(boardsWarning, "");
    if (!boardInfo || !currentUser) return;
    const userId = currentUser.uid;
    try {
      const memberRef = firebaseSdk.doc(database, "boards", boardInfo.id, "members", currentUser.uid);
      const memberSnapshot = await firebaseSdk.getDoc(memberRef);
      if (currentUser?.uid !== userId) return;
      if (!memberSnapshot.exists()) {
        throw new Error("Você não tem acesso a este quadro.");
      }

      stopBoardListeners();
      tasks = [];
      columns = defaultColumns;
      applyColumns({ empty: true });
      selectedBoard = boardInfo;
      selectedRole = memberSnapshot.data().papel;
      if (!["OWNER", "EDITOR", "VIEWER"].includes(selectedRole)) {
        throw new Error("O quadro tem um papel de acesso inválido.");
      }
      boardTitle.textContent = boardInfo.nome;
      boardSubtitle.textContent = selectedRole === "OWNER"
        ? "Você é proprietário deste quadro."
        : selectedRole === "EDITOR"
          ? "Você pode editar as tarefas deste quadro."
          : "Você está visualizando este quadro.";
      boardPicker.hidden = true;
      boardApp.hidden = false;
      authPanel.hidden = true;
      membersButton.hidden = false;
      renderTasks();

      stopBoardMembers = firebaseSdk.onSnapshot(
        firebaseSdk.collection(database, "boards", boardInfo.id, "members"),
        snapshot => {
          boardMembers = new Map(snapshot.docs.map(doc => [doc.id, doc.data()]));
          renderTasks();
        },
        error => reportActionError("Não foi possível carregar os responsáveis", error)
      );

      function leaveRevokedBoard() {
        showBoardPicker([]);
        fetchBoards()
          .then(boards => { if (currentUser?.uid === userId && !selectedBoard) renderBoardList(boards); })
          .catch(error => reportActionError("Não foi possível carregar seus quadros", error, boardsWarning));
      }

      stopMemberListener = firebaseSdk.onSnapshot(memberRef, snapshot => {
        if (!snapshot.exists()) {
          leaveRevokedBoard();
          return;
        }
        selectedRole = snapshot.data().papel;
        boardSubtitle.textContent = selectedRole === "OWNER" ? "Você é proprietário deste quadro."
          : canEditBoard() ? "Você pode editar as tarefas deste quadro." : "Você está visualizando este quadro.";
        if (!canEditBoard()) {
          if (columnDialog.open) columnDialog.close();
          if (taskBackdrop.classList.contains("open")) closeTaskModal();
        }
        if (selectedRole !== "OWNER" && membersModalBackdrop.classList.contains("open")) {
          closeModal(membersModalBackdrop);
        }
        renderTasks();
      }, error => {
        if (error.code === "permission-denied") leaveRevokedBoard();
        else reportActionError("Falha ao verificar sua permissão no quadro", error);
      });

      const columnsCollection = firebaseSdk.collection(database, "boards", boardInfo.id, "columns");
      stopColumnListener = firebaseSdk.onSnapshot(columnsCollection, applyColumns, error => {
        reportActionError("Falha ao carregar as colunas", error);
      });

      const tasksCollection = firebaseSdk.collection(database, "boards", boardInfo.id, "tasks");
      stopTaskListener = firebaseSdk.onSnapshot(
        firebaseSdk.query(tasksCollection, firebaseSdk.orderBy("createdAt", "desc")),
        snapshot => {
          tasks = snapshot.docs
            .map(document => ({ id: document.id, ...document.data() }))
            .filter(isValidTask);
          renderTasks();
          setBoardStatus(document.getElementById("storage-warning"), "Quadro sincronizado com o Firebase.", "success");
        },
        error => reportActionError("Falha ao sincronizar as tarefas", error)
      );
    } catch (error) {
      reportActionError("Não foi possível abrir o quadro", error, boardsWarning);
      selectedBoard = null;
      selectedRole = null;
      boardPicker.hidden = false;
      boardApp.hidden = true;
    }
  }

  async function openMembersModal() {
    lastFocusedElement = document.activeElement;
    membersModalBackdrop.classList.add("open");
    membersModalBackdrop.setAttribute("aria-hidden", "false");
    inviteForm.hidden = selectedRole !== "OWNER";
    setBoardStatus(inviteWarning, "");
    memberList.replaceChildren();

    try {
      const membersCollection = firebaseSdk.collection(database, "boards", selectedBoard.id, "members");
      const snapshot = await firebaseSdk.getDocs(membersCollection);
      snapshot.docs
        .map(document => ({ id: document.id, ...document.data() }))
        .sort((left, right) => left.papel === "OWNER" ? -1 : right.papel === "OWNER" ? 1 : left.email.localeCompare(right.email))
        .forEach(member => {
          const item = document.createElement("li");
          item.className = "member-row";
          const info = document.createElement("div");
          info.className = "member-info";
          const name = document.createElement("strong");
          name.textContent = member.nome || member.email || "Membro";
          const email = document.createElement("span");
          email.textContent = member.email || "";
          info.append(name, email);

          const controls = document.createElement("div");
          controls.className = "member-controls";
          if (selectedRole === "OWNER" && member.papel !== "OWNER") {
            const roleSelect = document.createElement("select");
            roleSelect.className = "member-role";
            roleSelect.setAttribute("aria-label", `Permissão de ${member.email}`);
            [
              ["EDITOR", "Editor"],
              ["VIEWER", "Leitor"]
            ].forEach(([value, label]) => {
              const option = document.createElement("option");
              option.value = value;
              option.textContent = label;
              roleSelect.appendChild(option);
            });
            roleSelect.value = member.papel;
            roleSelect.addEventListener("change", async () => {
              roleSelect.disabled = true;
              try {
                await firebaseSdk.updateDoc(
                  firebaseSdk.doc(database, "boards", selectedBoard.id, "members", member.userId),
                  { papel: roleSelect.value }
                );
              } catch (error) {
                reportActionError("Não foi possível alterar a permissão", error, inviteWarning);
                roleSelect.value = member.papel;
              } finally {
                roleSelect.disabled = false;
              }
            });

            const removeButton = document.createElement("button");
            removeButton.className = "remove-member";
            removeButton.type = "button";
            removeButton.textContent = "Remover";
            removeButton.addEventListener("click", async () => {
              removeButton.disabled = true;
              try {
                const batch = firebaseSdk.writeBatch(database);
                batch.update(firebaseSdk.doc(database, "boards", selectedBoard.id), {
                  memberIds: firebaseSdk.arrayRemove(member.userId)
                });
                batch.delete(firebaseSdk.doc(database, "boards", selectedBoard.id, "members", member.userId));
                await batch.commit();
                await openMembersModal();
              } catch (error) {
                reportActionError("Não foi possível remover este membro", error, inviteWarning);
                removeButton.disabled = false;
              }
            });
            controls.append(roleSelect, removeButton);
          } else {
            const roleLabel = document.createElement("span");
            roleLabel.className = "role-badge";
            roleLabel.textContent = member.papel === "OWNER"
              ? "Proprietário"
              : member.papel === "EDITOR" ? "Editor" : "Leitor";
            controls.appendChild(roleLabel);
          }

          item.append(info, controls);
          memberList.appendChild(item);
        });
    } catch (error) {
      reportActionError("Não foi possível carregar os membros", error, inviteWarning);
    }
  }

  async function inviteUser(event) {
    event.preventDefault();
    if (selectedRole !== "OWNER") return;
    const email = inviteEmail.value.trim().toLowerCase();
    const papel = inviteRole.value;
    if (!["EDITOR", "VIEWER"].includes(papel)) return;

    const submitButton = inviteForm.querySelector('[type="submit"]');
    submitButton.disabled = true;
    setBoardStatus(inviteWarning, "Buscando a conta...", "loading");
    try {
      const usersQuery = firebaseSdk.query(
        firebaseSdk.collection(database, "users"),
        firebaseSdk.where("email", "==", email)
      );
      const usersSnapshot = await firebaseSdk.getDocs(usersQuery);
      const invitedProfile = usersSnapshot.docs
        .map(document => document.data())
        .find(profile => profile.uid && profile.email === email);
      if (!invitedProfile) {
        throw new Error("Não encontramos uma conta com este e-mail. A pessoa precisa criar uma conta primeiro.");
      }
      if (invitedProfile.uid === currentUser.uid) {
        throw new Error("Você já é membro proprietário deste quadro.");
      }

      const memberRef = firebaseSdk.doc(database, "boards", selectedBoard.id, "members", invitedProfile.uid);
      if ((await firebaseSdk.getDoc(memberRef)).exists()) {
        throw new Error("Esta pessoa já participa do quadro.");
      }

      const batch = firebaseSdk.writeBatch(database);
      batch.update(firebaseSdk.doc(database, "boards", selectedBoard.id), {
        memberIds: firebaseSdk.arrayUnion(invitedProfile.uid)
      });
      batch.set(memberRef, {
        userId: invitedProfile.uid,
        email: invitedProfile.email,
        nome: invitedProfile.nome || invitedProfile.email,
        papel
      });
      await batch.commit();
      inviteForm.reset();
      setBoardStatus(inviteWarning, "Convite enviado. A pessoa já pode acessar o quadro.", "success");
      await openMembersModal();
    } catch (error) {
      if (error.code) {
        reportActionError("Não foi possível convidar esta pessoa", error, inviteWarning);
      } else {
        setBoardStatus(inviteWarning, error.message, "error");
      }
    } finally {
      submitButton.disabled = false;
    }
  }

  function openTaskModal() {
    if (!canEditBoard()) return;
    lastFocusedElement = document.activeElement;
    taskBackdrop.classList.add("open");
    taskBackdrop.setAttribute("aria-hidden", "false");
    taskTitleInput.focus();
  }

  function closeTaskModal() {
    taskBackdrop.classList.remove("open");
    taskBackdrop.setAttribute("aria-hidden", "true");
    taskForm.reset();
    if (lastFocusedElement) lastFocusedElement.focus();
  }

  function closeModal(backdrop) {
    backdrop.classList.remove("open");
    backdrop.setAttribute("aria-hidden", "true");
    if (lastFocusedElement) {
      lastFocusedElement.focus();
      lastFocusedElement = null;
    }
  }

  async function initializeBackend() {
    if (window.location.protocol === "file:") {
      setAuthStatus("Abra o app por um servidor local, como o Live Server, ou pelo endereço publicado no Firebase Hosting.", "error");
      return;
    }

    const requiredConfig = ["apiKey", "authDomain", "projectId", "appId"];
    const missingConfig = requiredConfig.filter(key => {
      const value = firebaseConfig[key];
      return typeof value !== "string" || value.trim() === "" || value.startsWith("COLE_");
    });
    if (missingConfig.length > 0) {
      setAuthStatus(`Preencha no firebase-config.js: ${missingConfig.join(", ")}.`, "error");
      return;
    }

    setAuthStatus("Conectando ao Firebase...", "loading");
    try {
      const [appSdk, authModule, firestoreModule] = await Promise.all([
        import("https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js"),
        import("https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js"),
        import("https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js")
      ]);
      const app = appSdk.initializeApp(firebaseConfig);
      authSdk = authModule;
      firebaseSdk = firestoreModule;
      firebaseAuth = authModule.getAuth(app);
      database = firestoreModule.getFirestore(app);

      authSdk.onAuthStateChanged(firebaseAuth, user => {
        authSubmit.disabled = false;
        authModeToggle.disabled = false;
        resetPasswordButton.disabled = false;
        if (user && !user.isAnonymous) {
          initializeSignedInUser(user).catch(error => {
            reportActionError("Não foi possível carregar sua conta e seus quadros", error, boardsWarning);
            authPanel.hidden = true;
            boardPicker.hidden = false;
          });
          return;
        }

        stopBoardListeners();
        stopTaskPage?.();
        stopTaskPage = null;
        currentUser = null;
        selectedBoard = null;
        selectedRole = null;
        accountControls.hidden = true;
        boardPicker.hidden = true;
        boardApp.hidden = true;
        authPanel.hidden = false;
        setBoardStatus(boardsWarning, "");
        setAuthStatus(
          user && user.isAnonymous
            ? "Sua sessão antiga é anônima. Crie uma conta para preservar suas tarefas e continuar."
            : "",
          "loading"
        );
      });
    } catch (error) {
      setAuthStatus("Não foi possível conectar ao Firebase. Confira o firebase-config.js e a conexão de rede.", "error");
      console.error("Não foi possível inicializar o Firebase.", error);
    }
  }

  authForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (!firebaseAuth || !authSdk) return;
    authSubmit.disabled = true;
    authModeToggle.disabled = true;
    resetPasswordButton.disabled = true;
    setAuthStatus(authMode === "register" ? "Criando sua conta..." : "Entrando...", "loading");

    try {
      const email = authEmail.value.trim();
      const password = authPassword.value;
      if (authMode === "register") {
        const name = authName.value.trim();
        pendingProfileName = name;
        const credential = authSdk.EmailAuthProvider.credential(email, password);
        const existingUser = firebaseAuth.currentUser;
        if (existingUser && existingUser.isAnonymous) {
          const linked = await authSdk.linkWithCredential(existingUser, credential);
          await authSdk.updateProfile(linked.user, { displayName: name });
        } else {
          const created = await authSdk.createUserWithEmailAndPassword(firebaseAuth, email, password);
          await authSdk.updateProfile(created.user, { displayName: name });
        }
      } else {
        const existingUser = firebaseAuth.currentUser;
        if (existingUser && existingUser.isAnonymous) {
          const legacyCollection = firebaseSdk.collection(database, "users", existingUser.uid, "tasks");
          const legacySnapshot = await firebaseSdk.getDocs(legacyCollection);
          pendingAnonymousTasks = legacySnapshot.docs.map(document => ({
            id: document.id,
            ...document.data()
          }));
        }
        await authSdk.signInWithEmailAndPassword(firebaseAuth, email, password);
      }
      authPassword.value = "";
      setAuthStatus("");
    } catch (error) {
      pendingAnonymousTasks = [];
      pendingProfileName = "";
      setAuthStatus(authErrorMessage(error), "error");
    } finally {
      authSubmit.disabled = false;
      authModeToggle.disabled = false;
      resetPasswordButton.disabled = false;
    }
  });

  authModeToggle.addEventListener("click", () => {
    setAuthMode(authMode === "login" ? "register" : "login");
    setAuthStatus("");
  });

  passwordVisibilityToggle.addEventListener("click", () => {
    const showPassword = authPassword.type === "password";
    authPassword.type = showPassword ? "text" : "password";
    const label = showPassword ? "Ocultar senha" : "Mostrar senha";
    passwordVisibilityToggle.setAttribute("aria-label", label);
    passwordVisibilityToggle.setAttribute("aria-pressed", String(showPassword));
    passwordVisibilityToggle.title = label;
  });

  resetPasswordButton.addEventListener("click", async () => {
    if (!firebaseAuth) return;
    const email = authEmail.value.trim();
    if (!email) {
      setAuthStatus("Informe seu e-mail para receber o link de redefinição.", "error");
      authEmail.focus();
      return;
    }
    resetPasswordButton.disabled = true;
    try {
      await authSdk.sendPasswordResetEmail(firebaseAuth, email);
      setAuthStatus("Se houver uma conta com esse e-mail, você receberá instruções para redefinir a senha.", "success");
    } catch (error) {
      setAuthStatus(authErrorMessage(error), "error");
    } finally {
      resetPasswordButton.disabled = false;
    }
  });

  signOutButton.addEventListener("click", async () => {
    signOutButton.disabled = true;
    try {
      await authSdk.signOut(firebaseAuth);
    } catch (error) {
      reportActionError("Não foi possível sair da conta", error);
    } finally {
      signOutButton.disabled = false;
    }
  });

  document.getElementById("create-board").addEventListener("click", () => {
    lastFocusedElement = document.activeElement;
    setBoardStatus(boardFormWarning, "");
    boardModalBackdrop.classList.add("open");
    boardModalBackdrop.setAttribute("aria-hidden", "false");
    boardNameInput.focus();
  });
  document.getElementById("back-to-boards").addEventListener("click", async () => {
    try {
      showBoardPicker(await fetchBoards());
    } catch (error) {
      reportActionError("Não foi possível carregar seus quadros", error, boardsWarning);
    }
  });
  [ownedBoards, sharedBoards].forEach(container => {
    container.addEventListener("click", event => {
      const button = event.target.closest(".board-card");
      if (!button) return;
      const boardInfo = [...ownedBoards.children, ...sharedBoards.children]
        .find(item => item.dataset.boardId === button.dataset.boardId);
      if (!boardInfo) return;
      fetchBoards()
        .then(items => selectBoard(items.find(item => item.id === button.dataset.boardId)))
        .catch(error => reportActionError("Não foi possível carregar seus quadros", error, boardsWarning));
    });
  });

  boardForm.addEventListener("submit", async event => {
    event.preventDefault();
    const name = boardNameInput.value.trim();
    if (!name || name.length > 80) return;
    const submitButton = boardForm.querySelector('[type="submit"]');
    submitButton.disabled = true;
    setBoardStatus(boardFormWarning, "Criando quadro...", "loading");
    try {
      const createdBoard = await createBoardRecord(name, currentUser);
      boardForm.reset();
      closeModal(boardModalBackdrop);
      const userBoards = await fetchBoards();
      renderBoardList(userBoards);
      await selectBoard(userBoards.find(item => item.id === createdBoard.id));
    } catch (error) {
      reportActionError("Não foi possível criar o quadro", error, boardFormWarning);
    } finally {
      submitButton.disabled = false;
    }
  });
  document.getElementById("close-board-modal").addEventListener("click", () => closeModal(boardModalBackdrop));
  document.getElementById("cancel-board-modal").addEventListener("click", () => closeModal(boardModalBackdrop));
  membersButton.addEventListener("click", openMembersModal);
  document.getElementById("close-members-modal").addEventListener("click", () => closeModal(membersModalBackdrop));
  inviteForm.addEventListener("submit", inviteUser);

  addTaskButton.addEventListener("click", openTaskModal);
  document.getElementById("close-modal").addEventListener("click", closeTaskModal);
  document.getElementById("cancel-modal").addEventListener("click", closeTaskModal);
  [taskBackdrop, boardModalBackdrop, membersModalBackdrop].forEach(backdrop => {
    backdrop.addEventListener("click", event => {
      if (event.target === backdrop) closeModal(backdrop);
    });
  });

  document.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    if (taskBackdrop.classList.contains("open")) closeTaskModal();
    if (boardModalBackdrop.classList.contains("open")) closeModal(boardModalBackdrop);
    if (membersModalBackdrop.classList.contains("open")) closeModal(membersModalBackdrop);
  });

  taskForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (!canEditBoard()) return;
    const title = taskTitleInput.value.trim();
    if (!title) {
      taskTitleInput.focus();
      return;
    }
    taskSubmitButton.disabled = true;
    try {
      const task = {
        id: createTaskId(),
        title,
        description: taskDescriptionInput.value.trim(),
        status: "todo",
        createdAt: new Date().toISOString(),
        board_id: selectedBoard.id,
        assigneeId: null,
        dueDate: null,
        priority: "MEDIUM",
        labels: [],
        storyPoints: null,
        checklist: []
      };
      const taskRef = firebaseSdk.doc(database, "boards", selectedBoard.id, "tasks", task.id);
      const batch = firebaseSdk.writeBatch(database);
      batch.set(taskRef, taskPayload(task));
      recordActivity(firebaseSdk, batch, taskRef, currentUser, "created");
      await batch.commit();
      closeTaskModal();
    } catch (error) {
      reportActionError("Não foi possível criar a tarefa", error);
    } finally {
      taskSubmitButton.disabled = false;
    }
  });

  board.addEventListener("click", async event => {
    const editColumn = event.target.closest(".edit-column");
    if (editColumn && canEditBoard()) {
      const status = editColumn.closest(".column").dataset.status;
      columnBeingEdited = columns.find(column => column.status === status) || defaultColumns.find(column => column.status === status);
      columnForm.elements.nome.value = columnBeingEdited.nome;
      columnForm.elements.wipLimit.value = columnBeingEdited.wipLimit ?? "";
      setBoardStatus(document.getElementById("column-feedback"), "");
      columnDialog.showModal();
      return;
    }
    const deleteButton = event.target.closest(".delete-button");
    if (!deleteButton || !canEditBoard()) return;
    const card = deleteButton.closest(".task-card");
    try {
      await firebaseSdk.deleteDoc(
        firebaseSdk.doc(database, "boards", selectedBoard.id, "tasks", card.dataset.taskId)
      );
    } catch (error) {
      reportActionError("Não foi possível excluir a tarefa", error);
    }
  });

  async function moveTask(taskId, status) {
    if (!canEditBoard() || !validStatuses.has(status)) return;
    const task = tasks.find(item => item.id === taskId);
    if (!task) return;
    const taskRef = firebaseSdk.doc(database, "boards", selectedBoard.id, "tasks", taskId);
    const user = currentUser;
    await firebaseSdk.runTransaction(database, async transaction => {
      const latest = await transaction.get(taskRef);
      if (!latest.exists() || latest.data().status === status) return;
      transaction.update(taskRef, { status });
      recordActivity(firebaseSdk, transaction, taskRef, user, status);
    });
  }

  board.addEventListener("keydown", async event => {
    const card = event.target.closest(".task-card");
    if (!card || event.target !== card || !canEditBoard() || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
    event.preventDefault();
    const order = columns.map(column => column.status);
    const task = tasks.find(item => item.id === card.dataset.taskId);
    if (!task) return;
    const nextIndex = order.indexOf(task.status) + (event.key === "ArrowRight" ? 1 : -1);
    if (nextIndex < 0 || nextIndex >= order.length) return;
    try {
      await moveTask(task.id, order[nextIndex]);
    } catch (error) {
      reportActionError("Não foi possível mover a tarefa", error);
    }
  });

  board.addEventListener("dragstart", event => {
    if (!canEditBoard()) return;
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
      if (!canEditBoard()) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      column.classList.add("drag-over");
    });
    column.addEventListener("dragleave", event => {
      if (!column.contains(event.relatedTarget)) column.classList.remove("drag-over");
    });
    column.addEventListener("drop", async event => {
      if (!canEditBoard()) return;
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

  document.getElementById("cancel-column").addEventListener("click", () => columnDialog.close());
  columnForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (!canEditBoard() || !columnBeingEdited) return;
    const nome = columnForm.elements.nome.value.trim();
    const wipLimit = columnForm.elements.wipLimit.valueAsNumber;
    const feedback = document.getElementById("column-feedback");
    if (!nome) return setBoardStatus(feedback, "Informe o nome da coluna.");
    const submit = columnForm.querySelector('[type="submit"]');
    submit.disabled = true;
    const { id, status, position } = columnBeingEdited;
    const boardId = selectedBoard.id;
    try {
      await firebaseSdk.setDoc(firebaseSdk.doc(database, "boards", boardId, "columns", id), {
        nome, status, position, wipLimit: Number.isNaN(wipLimit) ? null : wipLimit, board_id: boardId
      });
      columnDialog.close();
    } catch (error) {
      reportActionError("Não foi possível salvar a coluna", error, feedback);
    } finally {
      submit.disabled = false;
    }
  });

  setAuthMode("login");
  initializeBackend();
})();
