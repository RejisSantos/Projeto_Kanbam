export function recordActivity(sdk, writer, taskRef, user, action) {
  writer.set(sdk.doc(sdk.collection(taskRef, "activities")), {
    authorId: user.uid,
    action,
    createdAt: sdk.serverTimestamp()
  });
}

export function getTaskRoute(location) {
  const params = new URLSearchParams(location.search);
  const match = location.pathname.match(/^\/tasks\/([^/]+)\/?$/);
  if (!match && !params.has("task")) return null;
  const id = match ? match[1] : params.get("task");
  const boardId = params.get("board");
  const valid = value => /^[a-zA-Z0-9_-]{1,150}$/.test(value || "");
  return { id, boardId, valid: valid(id) && valid(boardId) };
}

export function openTaskPage({ sdk, db, user, route, report }) {
  const get = id => document.getElementById(id);
  const page = get("task-page");
  const content = get("task-content");
  const heading = get("task-heading");
  const context = get("task-context");
  const feedback = get("task-feedback");
  const form = get("task-details-form");
  const fields = get("task-fields");
  const save = get("task-save");
  const checkForm = get("check-form");
  const checkText = get("check-text");
  const commentForm = get("comment-form");
  const commentText = get("comment-text");
  const mentions = get("mention-options");
  const controls = [...form.querySelectorAll("[name]")];
  const dirty = new Set();
  const listeners = [];
  let task = null;
  let board = null;
  let members = [];
  let editing = false;
  let closed = false;
  let busy = false;

  function show(message, level = "error") {
    feedback.textContent = message;
    feedback.dataset.level = level;
    feedback.classList.toggle("visible", Boolean(message));
  }

  function stop() {
    closed = true;
    listeners.splice(0).forEach(unsubscribe => unsubscribe());
    page.hidden = true;
    document.title = "Orbit — Quadro Kanban";
  }

  function unavailable(message) {
    stop();
    page.hidden = false;
    content.hidden = true;
    heading.textContent = "Tarefa indisponível";
    context.textContent = "";
    show(message);
  }

  page.hidden = false;
  content.hidden = true;
  heading.textContent = "Detalhes da tarefa";
  context.textContent = "";
  checkForm.reset();
  commentForm.reset();
  mentions.replaceChildren();
  mentions.hidden = true;
  get("task-back").href = route.valid ? "/?board=" + encodeURIComponent(route.boardId) : "/";
  show("Carregando tarefa…", "loading");
  if (!route.valid) {
    unavailable("O link da tarefa está incompleto ou inválido.");
    return stop;
  }

  const boardRef = sdk.doc(db, "boards", route.boardId);
  const taskRef = sdk.doc(boardRef, "tasks", route.id);
  const memberRef = sdk.doc(boardRef, "members", user.uid);

  function checklist(data) {
    return Array.isArray(data.checklist)
      ? data.checklist.filter(item => item && typeof item.id === "string" && typeof item.text === "string")
      : [];
  }

  function refresh() {
    if (closed || !task || !board) return;
    content.hidden = false;
    heading.textContent = task.title;
    document.title = task.title + " | Orbit";
    context.textContent = board.nome + (editing ? "" : " · Somente leitura");
    fields.disabled = !editing || busy;
    save.hidden = !editing;
    checkForm.hidden = !editing;
    commentForm.hidden = !editing;
    checkForm.querySelector("button").disabled = busy;
    commentForm.querySelector("button").disabled = busy;

    const assignee = form.elements.assigneeId;
    const selected = dirty.has("assigneeId") ? assignee.value : task.assigneeId || "";
    assignee.replaceChildren(new Option("Sem responsável", ""));
    for (const member of members.filter(item => ["OWNER", "EDITOR"].includes(item.papel))) {
      assignee.add(new Option(member.nome, member.userId));
    }
    if (selected && ![...assignee.options].some(option => option.value === selected)) {
      assignee.add(new Option("Responsável indisponível", selected));
    }
    assignee.value = selected;

    for (const control of controls) {
      if (dirty.has(control.name) || control === assignee) continue;
      const value = task[control.name];
      control.value = control.name === "labels" ? (Array.isArray(value) ? value.join(", ") : "")
        : value ?? (control.name === "priority" ? "MEDIUM" : "");
    }

    const items = checklist(task);
    const done = items.filter(item => item.done === true).length;
    get("check-summary").textContent = done + " de " + items.length + " concluídas";
    get("check-progress").max = items.length || 1;
    get("check-progress").value = done;
    const active = document.activeElement;
    const focusedItem = active.closest("#check-items li")?.dataset.id;
    const rows = items.map(item => {
      const row = document.createElement("li");
      row.className = "check-row";
      row.dataset.id = item.id;
      const label = document.createElement("label");
      const toggle = document.createElement("input");
      toggle.type = "checkbox";
      toggle.checked = item.done === true;
      toggle.disabled = !editing;
      toggle.setAttribute("aria-disabled", String(busy));
      toggle.addEventListener("change", () => {
        const checked = toggle.checked;
        if (busy) { toggle.checked = item.done === true; return; }
        perform("Não foi possível atualizar a subtarefa", () =>
          changeChecklist(list => list.map(entry => entry.id === item.id ? { ...entry, done: checked } : entry)));
      });
      label.append(toggle, document.createTextNode(item.text));
      row.append(label);
      if (editing) {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "secondary-button";
        remove.textContent = "Remover";
        remove.setAttribute("aria-label", "Remover " + item.text);
        remove.setAttribute("aria-disabled", String(busy));
        remove.addEventListener("click", () => perform("Não foi possível remover a subtarefa", () =>
          changeChecklist(list => list.filter(entry => entry.id !== item.id))));
        row.append(remove);
      }
      return row;
    });
    get("check-items").replaceChildren(...rows);
    if (focusedItem && editing) {
      const row = rows.find(entry => entry.dataset.id === focusedItem);
      (row?.querySelector(active.tagName.toLowerCase()) || checkText).focus();
    }
  }

  async function perform(errorMessage, operation) {
    if (!editing || busy || !task || closed) return;
    busy = true;
    refresh();
    try {
      await operation();
      if (!closed) show("Alteração salva.", "success");
    } catch (error) {
      if (!closed) report(errorMessage, error, feedback);
    } finally {
      busy = false;
      refresh();
    }
  }

  function changeChecklist(transform) {
    return sdk.runTransaction(db, async transaction => {
      const snapshot = await transaction.get(taskRef);
      if (!snapshot.exists()) throw new Error("Tarefa removida.");
      const items = transform(checklist(snapshot.data()));
      if (items.length > 50) throw new Error("O checklist atingiu o limite de 50 subtarefas.");
      transaction.update(taskRef, { checklist: items });
      recordActivity(sdk, transaction, taskRef, user, "checklist");
    });
  }

  form.oninput = event => {
    if (event.target.name) dirty.add(event.target.name);
  };
  form.onsubmit = event => {
    event.preventDefault();
    if (!dirty.size) return;
    const changes = {};
    for (const name of dirty) {
      const value = form.elements[name].value.trim();
      changes[name] = value;
      if (name === "labels") changes.labels = [...new Set(value.split(",").map(label => label.trim()).filter(Boolean))];
      if (name === "storyPoints") changes.storyPoints = value ? Number(value) : null;
      if (name === "assigneeId" || name === "dueDate") changes[name] = value || null;
    }
    if (changes.title === "") return show("Informe o título da tarefa.");
    if (changes.labels?.length > 10 || changes.labels?.some(label => label.length > 30)) {
      return show("Use até 10 etiquetas com até 30 caracteres cada.");
    }
    perform("Não foi possível salvar a tarefa", async () => {
      await sdk.runTransaction(db, async transaction => {
        const snapshot = await transaction.get(taskRef);
        if (!snapshot.exists()) throw new Error("Tarefa removida.");
        const previous = snapshot.data();
        const updates = Object.fromEntries(Object.entries(changes).filter(([key, value]) =>
          JSON.stringify(previous[key]) !== JSON.stringify(value)));
        if (Object.keys(updates).length === 0) return;
        transaction.update(taskRef, updates);
        if ("status" in updates) recordActivity(sdk, transaction, taskRef, user, updates.status);
        if (Object.keys(updates).some(key => key !== "status")) recordActivity(sdk, transaction, taskRef, user, "edited");
      });
      dirty.clear();
    });
  };

  checkForm.onsubmit = event => {
    event.preventDefault();
    const text = checkText.value.trim();
    if (!text) return;
    if (task && checklist(task).length >= 50) return show("O checklist atingiu o limite de 50 subtarefas.");
    const id = globalThis.crypto.randomUUID();
    perform("Não foi possível adicionar a subtarefa", async () => {
      await changeChecklist(list => [...list, { id, text, done: false }]);
      checkForm.reset();
    });
  };

  commentText.oninput = () => {
    const end = commentText.selectionStart;
    const prefix = commentText.value.slice(0, end);
    const match = prefix.match(/(?:^|\s)@([^\s@]*)$/);
    const options = match ? members.filter(member =>
      member.nome.toLocaleLowerCase("pt-BR").includes(match[1].toLocaleLowerCase("pt-BR"))).slice(0, 6) : [];
    mentions.replaceChildren(...options.map(member => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "secondary-button";
      button.textContent = "@" + member.nome;
      button.onclick = () => {
        const start = prefix.lastIndexOf("@");
        commentText.setRangeText("@" + member.nome + " ", start, end, "end");
        mentions.hidden = true;
        commentText.focus();
      };
      return button;
    }));
    mentions.hidden = options.length === 0;
  };

  commentForm.onsubmit = event => {
    event.preventDefault();
    const text = commentText.value.trim();
    if (!text) return;
    const ownName = members.find(member => member.userId === user.uid)?.nome;
    if (!ownName) return show("Aguarde o carregamento dos membros e tente novamente.");
    perform("Não foi possível enviar o comentário", async () => {
      await sdk.addDoc(sdk.collection(taskRef, "comments"), {
        authorId: user.uid,
        authorName: ownName,
        text,
        createdAt: sdk.serverTimestamp()
      });
      if (commentText.value.trim() === text) {
        commentForm.reset();
        mentions.hidden = true;
      }
    });
  };

  function renderEntries(container, snapshot, isComment) {
    const labels = {
      created: "criou a tarefa", edited: "alterou os detalhes", checklist: "atualizou o checklist",
      ...Object.fromEntries([...form.elements.status.options].map(option => [option.value, "moveu para " + option.textContent]))
    };
    const rows = snapshot.docs.map(doc => {
      const entry = doc.data({ serverTimestamps: "estimate" });
      const li = document.createElement("li");
      const author = document.createElement("strong");
      author.textContent = isComment ? entry.authorName
        : members.find(member => member.userId === entry.authorId)?.nome || "Membro do quadro";
      li.append(author);
      if (!isComment) li.append(" " + (labels[entry.action] || "atualizou a tarefa"));
      const date = entry.createdAt?.toDate?.();
      if (date) {
        const time = document.createElement("time");
        time.dateTime = date.toISOString();
        time.textContent = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(date);
        li.append(time);
      }
      if (isComment) {
        const body = document.createElement("p");
        body.textContent = entry.text;
        li.append(body);
      }
      return li;
    });
    if (!rows.length) {
      const empty = document.createElement("li");
      empty.textContent = isComment ? "Nenhum comentário." : "Nenhuma atividade registrada.";
      rows.push(empty);
    }
    container.replaceChildren(...rows);
  }

  const accessError = error => {
    if (closed) return;
    if (error.code === "permission-denied") unavailable("Sua conta não tem acesso a esta tarefa.");
    else unavailable("Não foi possível carregar a tarefa. Confira a conexão e recarregue a página.");
  };
  const listen = (ref, callback, onError = accessError) =>
    listeners.push(sdk.onSnapshot(ref, snapshot => { if (!closed) callback(snapshot); }, onError));
  let started = false;
  let activitySnapshot = null;
  listen(memberRef, snapshot => {
    if (!snapshot.exists() || !["OWNER", "EDITOR", "VIEWER"].includes(snapshot.data().papel)) {
      unavailable("Sua conta não tem acesso a esta tarefa.");
      return;
    }
    editing = ["OWNER", "EDITOR"].includes(snapshot.data().papel);
    if (!editing) dirty.clear();
    refresh();
    if (started) return;
    started = true;
    listen(boardRef, boardSnapshot => {
      if (!boardSnapshot.exists()) return unavailable("Este quadro não está disponível.");
      board = boardSnapshot.data();
      refresh();
    });
    listen(taskRef, taskSnapshot => {
      if (!taskSnapshot.exists()) return unavailable("Esta tarefa foi removida ou não existe.");
      task = taskSnapshot.data();
      if (feedback.dataset.level === "loading") show("");
      refresh();
    });
    listen(sdk.collection(boardRef, "members"), memberSnapshot => {
      members = memberSnapshot.docs.map(doc => doc.data());
      refresh();
      if (activitySnapshot) renderEntries(get("task-activities"), activitySnapshot, false);
    });
    listen(sdk.collection(boardRef, "columns"), columnSnapshot => {
      for (const option of form.elements.status.options) {
        const column = columnSnapshot.docs.find(doc => doc.data().status === option.value);
        if (column) option.textContent = column.data().nome;
      }
      if (activitySnapshot) renderEntries(get("task-activities"), activitySnapshot, false);
    });
    const feedError = error => {
      if (!closed) report("Não foi possível carregar comentários ou histórico", error, feedback);
    };
    listen(sdk.query(sdk.collection(taskRef, "comments"), sdk.orderBy("createdAt")), snapshot =>
      renderEntries(get("task-comments"), snapshot, true), feedError);
    listen(sdk.query(sdk.collection(taskRef, "activities"), sdk.orderBy("createdAt", "desc")), snapshot => {
      activitySnapshot = snapshot;
      renderEntries(get("task-activities"), snapshot, false);
    }, feedError);
  });

  return stop;
}
