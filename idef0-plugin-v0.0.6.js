/*
 * IDEF0 helper plugin for draw.io / diagrams.net
 * Версия: 0.0.7
 * ------------------------------------------------
 * Журнал версий (ведётся с 0.0.6 - более ранние правки версией не помечались):
 *   0.0.6 - исправлено: угловые метки блока задачи (stampLink/stampChildCount)
 *           не пересчитывались вовсе, потому что код искал их через
 *           несуществующую в реальном XML роль idef0Role=taskGroup (группа
 *           блока задачи никогда не была так помечена - расхождение между
 *           инструкцией и фактическим шаблоном). Теперь группа блока задачи
 *           определяется автоматически как родитель фигуры taskMain, роль
 *           taskGroup больше не требуется и нигде не проверяется.
 *         - "IDEF0: Создать диаграмму процесса" получил резервные способы
 *           создания страницы на случай, если в конкретной сборке draw.io
 *           недоступно действие 'duplicatePage'.
 *   0.0.7 - исправлено: "Создать диаграмму процесса" для блока, у которого
 *           УЖЕ есть диаграмма-декомпозиция, иногда создавал новую страницу
 *           вместо перехода на существующую - похоже на рассинхронизацию
 *           id страницы после её создания (getPageId мог вернуть закешированное
 *           значение вместо актуального атрибута id узла страницы). getPageId
 *           переписан так, чтобы всегда сначала читать id из живого узла
 *           страницы (page.node), а не из метода page.getId(), плюс добавлена
 *           самопроверка сразу после создания страницы (сравнение id ссылки
 *           и id страницы) с явным предупреждением, если они разошлись.
 *           Также: если ссылка на блоке есть, но страница по ней не находится
 *           (битая/устаревшая ссылка) - теперь явно спрашивается подтверждение
 *           вместо молчаливого создания новой страницы.
 *         - "Создать диаграмму процесса" больше НЕ дублирует текущую
 *           страницу: новая страница собирается из встроенного пустого
 *           шаблона (см. BLANK_PAGE_XML) - шапка/низ как обычно, но БЕЗ
 *           примерной стрелки и с ОДНИМ пустым блоком процесса, без риска
 *           унаследовать лишние блоки задач или стрелки с той страницы,
 *           откуда её создали. Прежнее поведение (дублирование текущей
 *           страницы) осталось как резервный способ - на случай, если
 *           встроенный шаблон почему-то не удаётся собрать.
 *         - NODE новой страницы теперь вычисляется и проставляется СРАЗУ
 *           при создании (родитель уже точно известен - это не "унаследованная
 *           возможно устаревшая" ссылка, а только что установленная), без
 *           отдельного запуска "Обновить узлы..." и без диалога-подтверждения
 *           (он был нужен именно из-за риска устаревшей ссылки при
 *           дублировании, здесь этого риска больше нет). Имя вкладки новой
 *           страницы устанавливается равным этому NODE (например, "A11")
 *           вместо "Без названия" - см. setPageName. TITLE подставляется
 *           сразу из подписи блока-инициатора. AUTHOR/PROJECT копируются с
 *           родительской страницы.
 *         - Добавлены настройки (см. начало плагина и команды в Extras):
 *           "Уведомления о выполненных действиях" (вкл/выкл итоговых
 *           сообщений вида "готово", ошибки/предупреждения показываются
 *           всегда) и "Автообновление угловых меток" (при добавлении нового
 *           блока задачи или простановке/смене ссылки метки на активной
 *           странице пересчитываются сами, без запуска команды вручную).
 *           Обе настройки переключаются командами в Extras и запоминаются
 *           в localStorage между запусками draw.io.
 *
 * Добавляет в меню "Extras" пять команд, а также пункт "IDEF0: Создать
 * диаграмму процесса" в контекстное меню (правый клик) блока задачи:
 *
 *   1) "IDEF0: Обновить узлы, метки и TITLE"
 *      - Если у блока USED AT текущей страницы настроена ссылка (Edit Link)
 *        на другую страницу этого же файла - читает NODE родительской
 *        страницы, вычисляет свободный дочерний номер (наследование:
 *        A1 -> A11, A12, ...; A0 -> A1, A2, ... - см. computeNextNode),
 *        и, если блок NODE текущей страницы пуст, СПРАШИВАЕТ подтверждение
 *        (показывает, какая страница определена как родитель) и только
 *        после этого проставляет вычисленное значение.
 *      - Обновляет подпись блока USED AT значением NODE родительской
 *        страницы.
 *      - Для каждого блока задачи на текущей странице синхронизирует
 *        угловые метки (см. syncStampsOnly) - то же самое, что делает
 *        автообновление, только по явной команде и с итоговым отчётом.
 *      - Если TITLE текущей страницы пуст (или равен заготовке по
 *        умолчанию) - ищет по ВСЕМ страницам файла блок задачи, у
 *        которого Edit Link настроен на эту страницу, и подставляет в
 *        TITLE его подпись (value).
 *
 *   2) "IDEF0: Проставить дату версии"
 *      - Записывает в блок DATE "DATE: <сегодняшняя дата, ДД.ММ.ГГГГ>"
 *        (слово DATE сохраняется). Номер REV не меняется - вручную.
 *
 *   3) "IDEF0: Синхронизировать поля (с этой страницы)"
 *      - Берёт значения AUTHOR и PROJECT (или любых других ролей из
 *        SYNCED_ROLES, см. ниже) с ТЕКУЩЕЙ активной страницы, показывает
 *        их на подтверждение и копирует на ВСЕ страницы файла. Никакого
 *        текстового ввода (prompt) не требуется - только confirm(), т.к.
 *        window.prompt() не поддерживается в Electron-приложении draw.io
 *        Desktop.
 *
 *   4) "IDEF0: Уведомления о выполненных действиях (вкл/выкл)"
 *      - Переключает, показывать ли итоговые сообщения об успешном
 *        выполнении рутинных команд ("готово", "DATE обновлён" и т.п.).
 *        Предупреждения и ошибки показываются всегда, независимо от этой
 *        настройки. Состояние запоминается в localStorage.
 *
 *   5) "IDEF0: Автообновление угловых меток (вкл/выкл)"
 *      - Переключает автоматический пересчёт угловых меток блока задачи
 *        при изменении активной страницы (новый блок задачи, новая или
 *        изменённая ссылка и т.п.), без запуска команды 1) вручную.
 *        Состояние запоминается в localStorage.
 *
 *   Контекстное меню "IDEF0: Создать диаграмму процесса" - при правом
 *   клике на блоке задачи (или на контейнере, в который он вложен) создаёт
 *   новую страницу из встроенного пустого шаблона (один блок процесса,
 *   без примерной стрелки), сразу вычисляет и проставляет её NODE, TITLE,
 *   AUTHOR/PROJECT и имя вкладки, связывает её с исходным блоком (Edit
 *   Link в обе стороны) и переключается на неё.
 *
 * Про угловые метки блока задачи (см. стили stampChildCount/stampLink ниже):
 *   - stampChildCount (левый нижний угол) - количество блоков задач
 *     (taskMain) на странице, в которую декомпозируется этот блок (т.е.
 *     сколько подпроцессов на диаграмме-потомке). "0", если ссылки нет
 *     или страница не найдена.
 *   - stampLink (правый нижний угол) - NODE страницы, на которую
 *     настроена ссылка (Edit Link) у самого блока задачи (т.е. страницы
 *     его декомпозиции) - меняется вместе с этой ссылкой.
 *   Группа блока задачи (внутри которой ищутся метки) определяется САМА -
 *   как непосредственный родитель фигуры taskMain в модели, никакой
 *   специальной роли/тега у самой группы для этого иметь не нужно (с
 *   версии 0.0.6). Единственное условие - фигура taskMain и её метки
 *   должны быть сгруппированы вместе (Ctrl+G), иначе синхронизировать
 *   для этого блока нечего, и плагин его просто пропускает.
 *
 * ВАЖНО про многоуровневую вложенность:
 * алгоритм наследования NODE сам по себе поддерживает произвольную
 * глубину (A0 -> A1 -> A11 -> A111 -> ...), потому что на каждом шаге
 * NODE считается от НЕПОСРЕДСТВЕННОГО родителя, а не от корня.
 *
 * Как подключить плагин - см. idef0-instructions.md.
 *
 * ВАЖНО: скрипт использует внутренние (не задокументированные официально)
 * API draw.io (ui.selectPage, page.getId/getName, graph.getLinkForCell,
 * graph.cellLabelChanged, mxUtils.confirm, DiagramPage, ui.insertPage).
 * Эти API стабильны на протяжении многих версий draw.io, но при обновлении
 * приложения поведение теоретически может измениться. Если кнопки не
 * срабатывают - в instructions.md описан полностью ручной способ
 * заполнения всех тех же полей.
 */
Draw.loadPlugin(function (ui) {
	var ROLE_PREFIX = 'idef0Role=';
	var PLACEHOLDER_TITLE = 'TITLE: Название диаграммы';

	// Роли блоков, которые команда "Синхронизировать поля" копирует с
	// активной страницы на все остальные (текст копируется как есть,
	// целиком, без специальной обработки префиксов "AUTHOR: " и т.п.), а
	// также которые "Создать диаграмму процесса" копирует с родительской
	// страницы на только что созданную. Чтобы добавить новое
	// синхронизируемое поле - см. раздел 10 в idef0-instructions.md:
	// достаточно присвоить фигуре свою роль (idef0Role=вашаРоль;) и
	// дописать эту роль сюда строкой ниже.
	var SYNCED_ROLES = ['authorValue', 'projectValue'];

	// ---------- настройки плагина ----------
	// Меняются либо здесь в коде (DEFAULT_...), либо командами в меню
	// Extras ("IDEF0: Уведомления...", "IDEF0: Автообновление...") - в
	// этом случае выбор запоминается в localStorage и переживает
	// перезапуск draw.io (а если localStorage недоступен - тихо
	// откатывается к значению по умолчанию на каждый запуск).
	var DEFAULT_SHOW_NOTIFICATIONS = true;
	var DEFAULT_AUTO_SYNC_STAMPS = true;
	var SETTING_NOTIFICATIONS_KEY = 'idef0PluginShowNotifications';
	var SETTING_AUTOSYNC_KEY = 'idef0PluginAutoSyncStamps';

	function loadBoolSetting(key, defaultValue) {
		try {
			var raw = window.localStorage.getItem(key);
			if (raw === 'true') return true;
			if (raw === 'false') return false;
		} catch (e) {}
		return defaultValue;
	}

	function saveBoolSetting(key, value) {
		try {
			window.localStorage.setItem(key, value ? 'true' : 'false');
		} catch (e) {}
	}

	var showNotifications = loadBoolSetting(SETTING_NOTIFICATIONS_KEY, DEFAULT_SHOW_NOTIFICATIONS);
	var autoSyncStamps = loadBoolSetting(SETTING_AUTOSYNC_KEY, DEFAULT_AUTO_SYNC_STAMPS);

	// Уведомления об УСПЕШНОМ завершении рутинных команд ("готово", "DATE
	// обновлён" и т.п.) идут через notify() и подчиняются переключателю
	// showNotifications. Предупреждения об ошибках/невозможности что-то
	// сделать остаются обычным mxUtils.alert(...) и показываются всегда -
	// иначе легко не заметить, что автоматика молча не сработала.
	function notify(msg) {
		if (showNotifications) mxUtils.alert(msg);
	}

	function toggleNotifications() {
		showNotifications = !showNotifications;
		saveBoolSetting(SETTING_NOTIFICATIONS_KEY, showNotifications);
		mxUtils.alert('Уведомления об успешном выполнении команд IDEF0: ' + (showNotifications ? 'включены' : 'отключены') + '.');
	}

	function toggleAutoSyncStamps() {
		autoSyncStamps = !autoSyncStamps;
		saveBoolSetting(SETTING_AUTOSYNC_KEY, autoSyncStamps);
		mxUtils.alert('Автообновление угловых меток при изменениях страницы: ' + (autoSyncStamps ? 'включено' : 'отключено') + '.');
	}

	// ---------- низкоуровневые помощники ----------

	function trim(s) {
		return s == null ? '' : s.replace(/^\s+|\s+$/g, '');
	}

	function styleHasRole(style, role) {
		if (style == null) return false;
		return style.indexOf(ROLE_PREFIX + role + ';') >= 0;
	}

	function findCellsByRole(graph, role, scopeCell) {
		var result = [];
		var model = graph.getModel();
		var root = scopeCell || model.getRoot();

		function walk(cell) {
			if (cell.style != null && styleHasRole(cell.style, role)) {
				result.push(cell);
			}
			var cc = model.getChildCount(cell);
			for (var i = 0; i < cc; i++) {
				walk(model.getChildAt(cell, i));
			}
		}

		walk(root);
		return result;
	}

	// С версии 0.0.7 порядок предпочтения обратный прежнему: сначала
	// читаем id напрямую из живого узла страницы (page.node) и только если
	// это не удалось - пробуем метод page.getId(). Причина: у некоторых
	// объектов страницы .getId() может возвращать закешированное на момент
	// создания значение, тогда как реальный id, под которым страница
	// попала в ui.pages (и по которому её ищут через data:page/id,...),
	// это то, что записано в атрибуте id её XML-узла - именно он и должен
	// быть источником истины. Есть подозрение, что рассинхронизация именно
	// этих двух источников была причиной, по которой "Создать диаграмму
	// процесса" иногда не находил уже существующую диаграмму-декомпозицию
	// блока и создавал новую вместо перехода на неё.
	function getPageId(page) {
		try {
			if (page.node != null && typeof page.node.getAttribute === 'function') {
				var idFromNode = page.node.getAttribute('id');
				if (idFromNode) return idFromNode;
			}
		} catch (e) {}
		try {
			if (typeof page.getId === 'function') return page.getId();
		} catch (e) {}
		return null;
	}

	function getPageName(page) {
		try {
			if (typeof page.getName === 'function') return page.getName();
		} catch (e) {}
		try {
			return page.node.getAttribute('name');
		} catch (e) {}
		return '(без имени)';
	}

	function setPageName(page, name) {
		try {
			if (typeof page.setName === 'function') {
				page.setName(name);
				return true;
			}
		} catch (e) {}
		try {
			if (page.node != null && typeof page.node.setAttribute === 'function') {
				page.node.setAttribute('name', name);
				return true;
			}
		} catch (e) {}
		return false;
	}

	function findPageById(pageId) {
		for (var i = 0; i < ui.pages.length; i++) {
			if (getPageId(ui.pages[i]) === pageId) return ui.pages[i];
		}
		return null;
	}

	// Внутренний формат ссылки draw.io на страницу того же файла:
	// "data:page/id,<pageId>"
	function pageIdFromLink(link) {
		if (link == null) return null;
		var prefix = 'data:page/id,';
		if (link.substring(0, prefix.length) === prefix) {
			return link.substring(prefix.length);
		}
		return null;
	}

	function confirmDialog(msg) {
		try {
			if (typeof mxUtils.confirm === 'function') return mxUtils.confirm(msg);
		} catch (e) {}
		return window.confirm(msg);
	}

	// Выполняет fn(graph) в контексте страницы page, временно переключаясь
	// на неё, если она сейчас не активна, и возвращая исходную страницу
	// обратно. Безопасно вызывать в цикле (стек original/switched
	// корректно восстанавливает исходную страницу на каждом вызове).
	function withPage(page, fn) {
		if (typeof ui.selectPage !== 'function') {
			return { unsupported: true };
		}
		var original = ui.currentPage;
		var switched = false;
		try {
			if (original !== page) {
				ui.selectPage(page);
				switched = true;
			}
			return { value: fn(ui.editor.graph) };
		} finally {
			if (switched && original != null) {
				ui.selectPage(original);
			}
		}
	}

	function readRoleValue(page, role) {
		var res = withPage(page, function (graph) {
			var cells = findCellsByRole(graph, role);
			if (cells.length === 0) return null;
			return graph.convertValueToString(cells[0]);
		});
		if (res.unsupported) return { unsupported: true };
		return { value: res.value };
	}

	function readUsedAtLink(page) {
		var res = withPage(page, function (graph) {
			var cells = findCellsByRole(graph, 'usedAtValue');
			if (cells.length === 0) return null;
			return graph.getLinkForCell(cells[0]);
		});
		if (res.unsupported) return { unsupported: true };
		return { value: res.value };
	}

	// Ищет по всем страницам файла блоки задач (taskMain), у которых
	// ссылка (Edit Link) настроена на страницу targetPageId. Используется
	// для автозаполнения TITLE новой страницы подписью того блока, который
	// на неё ссылается.
	function findReferencingTaskBoxes(targetPageId) {
		var matches = [];
		for (var i = 0; i < ui.pages.length; i++) {
			var candidatePage = ui.pages[i];
			var res = withPage(candidatePage, function (graph) {
				var mains = findCellsByRole(graph, 'taskMain');
				var found = [];
				for (var j = 0; j < mains.length; j++) {
					var link = graph.getLinkForCell(mains[j]);
					if (pageIdFromLink(link) === targetPageId) {
						found.push(graph.convertValueToString(mains[j]));
					}
				}
				return found;
			});
			if (!res.unsupported && res.value && res.value.length) {
				for (var k = 0; k < res.value.length; k++) {
					matches.push({ pageName: getPageName(candidatePage), label: res.value[k] });
				}
			}
		}
		return matches;
	}

	// ---------- алгоритм наследования NODE ----------
	// Правило пользователя: если диаграмма - потомок страницы с NODE = "A1",
	// то по умолчанию (если ещё не существует) её NODE = "A11" (простая
	// конкатенация родителя и следующей свободной цифры). Это работает на
	// ЛЮБОЙ глубине, т.к. на каждом шаге берётся NODE НЕПОСРЕДСТВЕННОГО
	// родителя, а не корня: A0->A1->A11->A111...
	// Единственное уточнение: у корневой страницы "A0" отбрасывается
	// завершающий "0" перед конкатенацией, иначе стандартная нотация
	// IDEF0 (A0 -> A1, A2, A3 ...) была бы нарушена. Если такое уточнение
	// не нужно - удалите условие ниже и используйте parentNode напрямую.
	function stripParentNode(parentNode) {
		if (parentNode === 'A0') return 'A';
		return parentNode;
	}

	function computeNextNode(parentNode, siblingNodes) {
		var base = stripParentNode(parentNode);
		var used = [];
		for (var i = 0; i < siblingNodes.length; i++) {
			var s = siblingNodes[i];
			if (s != null && s.substring(0, base.length) === base) {
				var rest = s.substring(base.length);
				var n = parseInt(rest, 10);
				if (!isNaN(n)) used.push(n);
			}
		}
		var next = 1;
		while (used.indexOf(next) >= 0) next++;
		return base + next;
	}

	// Вычисляет NODE для дочерней страницы данного родителя: находит все
	// существующие страницы, чья ссылка USED AT указывает на того же
	// родителя (siblings), и берёт первую свободную цифру после NODE
	// родителя. excludePage - страница, которую не нужно учитывать как
	// sibling (например, сама страница, для которой пересчитывается NODE);
	// при вычислении NODE для ЕЩЁ НЕ СОЗДАННОЙ страницы передавайте null -
	// новой страницы ещё нет в ui.pages, исключать нечего.
	function computeChildNodeForParent(parentPage, parentNode, excludePage) {
		var siblingNodes = [];
		for (var i = 0; i < ui.pages.length; i++) {
			var candidate = ui.pages[i];
			if (candidate === excludePage) continue;
			var candLinkRes = readUsedAtLink(candidate);
			if (candLinkRes.unsupported) continue;
			var candParentId = pageIdFromLink(candLinkRes.value);
			if (candParentId === getPageId(parentPage)) {
				var candNodeRes = readRoleValue(candidate, 'nodeValue');
				if (!candNodeRes.unsupported && candNodeRes.value) {
					siblingNodes.push(trim(candNodeRes.value));
				}
			}
		}
		return computeNextNode(parentNode, siblingNodes);
	}

	// ---------- синхронизация угловых меток ----------
	// Используется и вручную (команда "Обновить узлы..."), и автоматически
	// (автообновление при изменениях страницы, см. ниже). Пишет новое
	// значение только если оно действительно отличается от текущего - это
	// не только чуть экономнее, но и не плодит лишние записи в истории
	// undo и не помечает файл изменённым без реальных изменений, что важно
	// для автообновления (иначе документ выглядел бы "изменённым" сразу
	// после открытия, даже если открыли только посмотреть).
	function syncStampsOnly(graph) {
		var model = graph.getModel();
		var defaultParent = graph.getDefaultParent();
		var mainsAll = findCellsByRole(graph, 'taskMain');
		var stamped = 0;
		var skippedUngrouped = 0;

		for (var mi = 0; mi < mainsAll.length; mi++) {
			var mainCell = mainsAll[mi];
			var scopeCell = model.getParent(mainCell);

			// если фигура задачи не сгруппирована (родитель - сам слой
			// страницы) - синхронизировать нечего, пропускаем её, а не всю
			// страницу целиком (иначе можно случайно затронуть метки чужих
			// блоков)
			if (scopeCell == null || scopeCell === defaultParent || scopeCell === model.getRoot()) {
				skippedUngrouped++;
				continue;
			}

			var countStamps = findCellsByRole(graph, 'stampChildCount', scopeCell);
			var linkStamps = findCellsByRole(graph, 'stampLink', scopeCell);

			var targetNode = '—';
			var childCount = '0';

			var mainLink = graph.getLinkForCell(mainCell);
			var targetId = pageIdFromLink(mainLink);
			if (targetId != null) {
				var targetPage = findPageById(targetId);
				if (targetPage != null) {
					var tn = readRoleValue(targetPage, 'nodeValue');
					if (!tn.unsupported && tn.value) {
						targetNode = trim(tn.value) || '—';
					}
					var ccRes = withPage(targetPage, function (g2) {
						return findCellsByRole(g2, 'taskMain').length;
					});
					if (!ccRes.unsupported) {
						childCount = String(ccRes.value);
					}
				}
			}

			for (var l = 0; l < linkStamps.length; l++) {
				if (graph.convertValueToString(linkStamps[l]) !== targetNode) {
					graph.cellLabelChanged(linkStamps[l], targetNode, false);
					stamped++;
				}
			}
			for (var c2 = 0; c2 < countStamps.length; c2++) {
				if (graph.convertValueToString(countStamps[c2]) !== childCount) {
					graph.cellLabelChanged(countStamps[c2], childCount, false);
					stamped++;
				}
			}
		}

		return { stamped: stamped, skipped: skippedUngrouped };
	}

	// ---------- автообновление угловых меток при изменениях страницы ----------
	// Если autoSyncStamps включён (по умолчанию - да) - при любом изменении
	// модели активной страницы (новый блок задачи, простановка/смена
	// ссылки, удаление и т.п.) угловые метки на этой странице
	// пересчитываются сами, без запуска команды 1) вручную. NODE/USED
	// AT/TITLE автообновлением не затрагиваются - они по-прежнему требуют
	// ручного запуска той команды (там нужно подтверждение пользователя
	// при первом присвоении NODE).
	var autoSyncTimer = null;
	var autoSyncInProgress = false;

	function runAutoSyncStamps() {
		if (autoSyncInProgress) return;
		autoSyncInProgress = true;
		try {
			syncStampsOnly(ui.editor.graph);
		} catch (e) {
			// фоновая автоматика не должна мешать работе, даже если что-то пошло не так
		} finally {
			autoSyncInProgress = false;
		}
	}

	function handleModelChangeForAutoSync() {
		if (!autoSyncStamps || autoSyncInProgress) return;
		if (autoSyncTimer != null) {
			clearTimeout(autoSyncTimer);
		}
		// небольшая задержка - чтобы не пересчитывать на каждое
		// промежуточное событие модели (например, при перетаскивании)
		autoSyncTimer = setTimeout(function () {
			autoSyncTimer = null;
			runAutoSyncStamps();
		}, 400);
	}

	var autoSyncAttachedModel = null;

	function ensureAutoSyncListener() {
		try {
			var model = ui.editor.graph.getModel();
			if (model === autoSyncAttachedModel) return;
			autoSyncAttachedModel = model;
			model.addListener(mxEvent.CHANGE, handleModelChangeForAutoSync);
		} catch (e) {}
	}

	ensureAutoSyncListener();
	try {
		if (typeof ui.editor.addListener === 'function') {
			ui.editor.addListener('pageSelected', function () {
				ensureAutoSyncListener();
			});
		}
	} catch (e) {}

	// ---------- действие 1: обновить узлы, метки и TITLE ----------

	function updateNodesAndStamps() {
		autoSyncInProgress = true;
		try {
			var graph = ui.editor.graph;
			var page = ui.currentPage;

			if (typeof ui.selectPage !== 'function') {
				mxUtils.alert(
					'Автоматическое чтение других страниц недоступно в этой версии draw.io.\n' +
						'Заполните NODE, USED AT, угловые метки и TITLE вручную (см. instructions.md).'
				);
				return;
			}

			var log = [];

			// 1) значение из USED AT -> родительская страница
			var usedAtCells = findCellsByRole(graph, 'usedAtValue');
			var parentPage = null;
			var parentNode = null;

			if (usedAtCells.length > 0) {
				var link = graph.getLinkForCell(usedAtCells[0]);
				var parentId = pageIdFromLink(link);
				if (parentId != null) {
					parentPage = findPageById(parentId);
					if (parentPage != null) {
						var pn = readRoleValue(parentPage, 'nodeValue');
						if (!pn.unsupported && pn.value) {
							parentNode = trim(pn.value);
						}
					}
				}
			}

			if (parentPage != null && parentNode) {
				// обновить подпись USED AT значением NODE родителя
				graph.cellLabelChanged(usedAtCells[0], parentNode, false);
				log.push('USED AT обновлён: ' + parentNode + ' (родительская страница «' + getPageName(parentPage) + '»)');

				// 2) собственный NODE - только если сейчас пуст, и только после
				// подтверждения пользователем (защита от "A2 вместо A11" при
				// неверно настроенной ссылке USED AT)
				var nodeCells = findCellsByRole(graph, 'nodeValue');
				if (nodeCells.length > 0) {
					var currentNode = trim(graph.convertValueToString(nodeCells[0]));

					if (currentNode === '' || currentNode === '—') {
						var newNode = computeChildNodeForParent(parentPage, parentNode, page);
						var confirmMsg =
							'Родительская страница определена как «' + getPageName(parentPage) + '» (NODE = ' + parentNode + ').\n' +
							'Присвоить текущей странице NODE = ' + newNode + '?\n\n' +
							'Если родитель определён неверно - нажмите "Отмена" и проверьте ссылку (Edit Link) у блока USED AT: ' +
							'после дублирования страницы ссылка могла остаться указывающей на старого (более далёкого) родителя.';

						if (confirmDialog(confirmMsg)) {
							graph.cellLabelChanged(nodeCells[0], newNode, false);
							log.push('NODE назначен: ' + newNode);
						} else {
							log.push('Назначение NODE отменено пользователем - проверьте ссылку USED AT');
						}
					} else {
						log.push('NODE уже заполнен (' + currentNode + '), не изменён');
					}
				}
			} else {
				log.push('Ссылка USED AT на родительскую страницу не настроена - NODE не пересчитывался');
			}

			// 3) синхронизировать угловые метки во всех блоках задач страницы
			var stampRes = syncStampsOnly(graph);
			log.push(
				'Синхронизировано угловых меток: ' + stampRes.stamped +
					(stampRes.skipped > 0 ? ' (пропущено несгруппированных блоков задач: ' + stampRes.skipped + ')' : '')
			);

			// 4) авто-заполнение TITLE подписью блока, который ссылается на эту страницу
			var titleCells = findCellsByRole(graph, 'titleValue');
			if (titleCells.length > 0) {
				var currentTitle = trim(graph.convertValueToString(titleCells[0]));
				if (currentTitle === '' || currentTitle === PLACEHOLDER_TITLE) {
					var refs = findReferencingTaskBoxes(getPageId(page));
					if (refs.length === 1) {
						graph.cellLabelChanged(titleCells[0], 'TITLE: ' + refs[0].label, false);
						log.push('TITLE заполнен по подписи блока со страницы «' + refs[0].pageName + '»: ' + refs[0].label);
					} else if (refs.length > 1) {
						log.push(
							'Найдено несколько блоков, ссылающихся на эту страницу - TITLE не изменён, заполните вручную (варианты: ' +
								refs.map(function (r) { return r.label; }).join(' | ') +
								')'
						);
					} else {
						log.push('Не найден блок задачи, ссылающийся на эту страницу - TITLE не изменён');
					}
				} else {
					log.push('TITLE уже заполнен, не изменён');
				}
			}

			notify('IDEF0: готово.\n\n' + log.join('\n'));
		} finally {
			autoSyncInProgress = false;
		}
	}

	// ---------- действие 2: дата версии ----------

	function stampVersionDate() {
		var graph = ui.editor.graph;
		var dateCells = findCellsByRole(graph, 'dateValue');

		if (dateCells.length === 0) {
			mxUtils.alert('Блок DATE (idef0Role=dateValue) не найден на текущей странице.');
			return;
		}

		function pad(n) {
			return (n < 10 ? '0' : '') + n;
		}
		var d = new Date();
		var formatted = pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear();

		graph.cellLabelChanged(dateCells[0], 'DATE: ' + formatted, false);
		notify('DATE обновлён: ' + formatted + '\n\nНе забудьте вручную поднять REV.');
	}

	// ---------- действие 3: синхронизация полей по всем страницам ----------
	// Не использует prompt() (не работает в Electron/draw.io Desktop -
	// см. заголовок файла), только confirm(): значения берутся с активной
	// страницы, показываются на подтверждение и копируются на все страницы.

	function syncFields() {
		autoSyncInProgress = true;
		try {
			var graph = ui.editor.graph;

			if (typeof ui.selectPage !== 'function') {
				mxUtils.alert('Синхронизация недоступна в этой версии draw.io - обновите поля на каждой странице вручную.');
				return;
			}

			var sourceValues = {};
			var summaryLines = [];
			for (var r = 0; r < SYNCED_ROLES.length; r++) {
				var role = SYNCED_ROLES[r];
				var cells = findCellsByRole(graph, role);
				var value = cells.length ? graph.convertValueToString(cells[0]) : null;
				sourceValues[role] = value;
				summaryLines.push(role + ': "' + (value || '') + '"' + (cells.length ? '' : ' (блок не найден на этой странице)'));
			}

			var confirmMsg =
				'Скопировать со страницы «' + getPageName(ui.currentPage) + '» на ВСЕ страницы файла (' + ui.pages.length + '):\n\n' +
				summaryLines.join('\n') +
				'\n\nЕсли значения не те - откройте нужную страницу-источник и запустите команду заново. Продолжить?';

			if (!confirmDialog(confirmMsg)) return;

			var updatedCells = 0;
			var updatedPages = 0;
			for (var i = 0; i < ui.pages.length; i++) {
				var res = withPage(ui.pages[i], function (g) {
					var count = 0;
					for (var rr = 0; rr < SYNCED_ROLES.length; rr++) {
						var v = sourceValues[SYNCED_ROLES[rr]];
						if (v == null) continue;
						var targetCells = findCellsByRole(g, SYNCED_ROLES[rr]);
						for (var c = 0; c < targetCells.length; c++) {
							g.cellLabelChanged(targetCells[c], v, false);
							count++;
						}
					}
					return count;
				});
				if (!res.unsupported) {
					updatedCells += res.value || 0;
					updatedPages++;
				}
			}

			notify('Готово. Обновлено блоков: ' + updatedCells + ' на ' + updatedPages + ' страницах.');
		} finally {
			autoSyncInProgress = false;
		}
	}

	// ---------- пустой шаблон новой страницы ----------
	// Полный шаблон страницы IDEF0 (шапка/низ - все блоки шаблона, как на
	// страницах-примерах), но БЕЗ примерной стрелки и с единственным
	// пустым блоком задачи - используется вместо дублирования текущей
	// страницы (с версии 0.0.7), чтобы на новой странице не оказывалось
	// лишних блоков задач/стрелок, случайно унаследованных с той страницы,
	// откуда её создали. Идентификаторы ячеек внутри специально короткие и
	// без префикса страницы - им достаточно быть уникальными только внутри
	// ЭТОЙ страницы (у каждой <diagram> в файле свой собственный root), а
	// не по всему файлу.
	var BLANK_PAGE_XML =
		'<mxGraphModel dx="1169" dy="827" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1169" pageHeight="827" math="0" shadow="0" background="#ffffff">' +
		'<root>' +
		'<mxCell id="0" />' +
		'<mxCell id="1" parent="0" />' +
		'<mxCell id="usedAtGroup" style="group" vertex="1" connectable="0" parent="1"><mxGeometry x="10" y="10" width="150" height="140" as="geometry" /></mxCell>' +
		'<mxCell id="usedAtOutline" style="rounded=0;whiteSpace=wrap;html=1;fillColor=none;fontFamily=Verdana;fontSize=11;" vertex="1" parent="usedAtGroup"><mxGeometry width="150" height="140" as="geometry" /></mxCell>' +
		'<mxCell id="usedAtCaption" value="USED AT:" style="text;html=1;align=left;verticalAlign=top;fontFamily=Verdana;fontSize=11;fontStyle=1;spacing=4;" vertex="1" parent="usedAtGroup"><mxGeometry width="150" height="20" as="geometry" /></mxCell>' +
		'<mxCell id="usedAtValue" value="—" style="rounded=0;whiteSpace=wrap;html=1;fontFamily=Verdana;fontSize=30;align=center;verticalAlign=middle;idef0Role=usedAtValue;" vertex="1" parent="usedAtGroup"><mxGeometry y="22" width="150" height="118" as="geometry" /></mxCell>' +
		'<mxCell id="author" value="AUTHOR: " style="rounded=0;whiteSpace=wrap;html=1;fontFamily=Verdana;fontSize=16;labelPosition=center;verticalLabelPosition=middle;align=right;verticalAlign=top;idef0Role=authorValue;" vertex="1" parent="1"><mxGeometry x="174" y="10" width="260" height="47" as="geometry" /></mxCell>' +
		'<mxCell id="project" value="PROJECT: " style="rounded=0;whiteSpace=wrap;html=1;fontFamily=Verdana;fontSize=16;labelPosition=center;verticalLabelPosition=middle;align=right;verticalAlign=top;idef0Role=projectValue;" vertex="1" parent="1"><mxGeometry x="174" y="57" width="260" height="47" as="geometry" /></mxCell>' +
		'<mxCell id="notes" value="NOTES: " style="rounded=0;whiteSpace=wrap;html=1;fontFamily=Verdana;fontSize=16;labelPosition=center;verticalLabelPosition=middle;align=right;verticalAlign=top;" vertex="1" parent="1"><mxGeometry x="174" y="104" width="260" height="46" as="geometry" /></mxCell>' +
		'<mxCell id="date" value="DATE: —" style="rounded=0;whiteSpace=wrap;html=1;fontFamily=Verdana;fontSize=16;labelPosition=center;verticalLabelPosition=middle;align=right;verticalAlign=top;idef0Role=dateValue;" vertex="1" parent="1"><mxGeometry x="448" y="10" width="140" height="70" as="geometry" /></mxCell>' +
		'<mxCell id="rev" value="REV: 1" style="rounded=0;whiteSpace=wrap;html=1;fontFamily=Verdana;fontSize=16;labelPosition=center;verticalLabelPosition=middle;align=right;verticalAlign=top;" vertex="1" parent="1"><mxGeometry x="448" y="80" width="140" height="70" as="geometry" /></mxCell>' +
		'<mxCell id="st_c1" value="" style="rounded=0;whiteSpace=wrap;html=1;fontFamily=Verdana;fontSize=16;" vertex="1" parent="1"><mxGeometry x="602" y="10" width="40" height="35" as="geometry" /></mxCell>' +
		'<mxCell id="st_l1" value="Working" style="rounded=0;whiteSpace=wrap;html=1;fontFamily=Verdana;fontSize=16;labelPosition=center;verticalLabelPosition=middle;align=right;verticalAlign=top;" vertex="1" parent="1"><mxGeometry x="642" y="10" width="150" height="35" as="geometry" /></mxCell>' +
		'<mxCell id="st_c2" value="" style="rounded=0;whiteSpace=wrap;html=1;fontFamily=Verdana;fontSize=16;" vertex="1" parent="1"><mxGeometry x="602" y="45" width="40" height="35" as="geometry" /></mxCell>' +
		'<mxCell id="st_l2" value="Draft" style="rounded=0;whiteSpace=wrap;html=1;fontFamily=Verdana;fontSize=16;labelPosition=center;verticalLabelPosition=middle;align=right;verticalAlign=top;" vertex="1" parent="1"><mxGeometry x="642" y="45" width="150" height="35" as="geometry" /></mxCell>' +
		'<mxCell id="st_c3" value="" style="rounded=0;whiteSpace=wrap;html=1;fontFamily=Verdana;fontSize=16;" vertex="1" parent="1"><mxGeometry x="602" y="80" width="40" height="35" as="geometry" /></mxCell>' +
		'<mxCell id="st_l3" value="Recommended" style="rounded=0;whiteSpace=wrap;html=1;fontFamily=Verdana;fontSize=16;labelPosition=center;verticalLabelPosition=middle;align=right;verticalAlign=top;" vertex="1" parent="1"><mxGeometry x="642" y="80" width="150" height="35" as="geometry" /></mxCell>' +
		'<mxCell id="st_c4" value="" style="rounded=0;whiteSpace=wrap;html=1;fontFamily=Verdana;fontSize=16;" vertex="1" parent="1"><mxGeometry x="602" y="115" width="40" height="35" as="geometry" /></mxCell>' +
		'<mxCell id="st_l4" value="Publication" style="rounded=0;whiteSpace=wrap;html=1;fontFamily=Verdana;fontSize=16;labelPosition=center;verticalLabelPosition=middle;align=right;verticalAlign=top;" vertex="1" parent="1"><mxGeometry x="642" y="115" width="150" height="35" as="geometry" /></mxCell>' +
		'<mxCell id="rd_h1" value="READER" style="rounded=0;whiteSpace=wrap;html=1;fontFamily=Verdana;fontSize=16;labelPosition=center;verticalLabelPosition=middle;align=right;verticalAlign=top;fontStyle=1;" vertex="1" parent="1"><mxGeometry x="806" y="10" width="95" height="35" as="geometry" /></mxCell>' +
		'<mxCell id="rd_h2" value="DATE" style="rounded=0;whiteSpace=wrap;html=1;fontFamily=Verdana;fontSize=16;labelPosition=center;verticalLabelPosition=middle;align=right;verticalAlign=top;fontStyle=1;" vertex="1" parent="1"><mxGeometry x="901" y="10" width="95" height="35" as="geometry" /></mxCell>' +
		'<mxCell id="rd_r2c1" value="" style="rounded=0;whiteSpace=wrap;html=1;fontFamily=Verdana;fontSize=16;labelPosition=center;verticalLabelPosition=middle;align=right;verticalAlign=top;" vertex="1" parent="1"><mxGeometry x="806" y="45" width="95" height="35" as="geometry" /></mxCell>' +
		'<mxCell id="rd_r2c2" value="" style="rounded=0;whiteSpace=wrap;html=1;fontFamily=Verdana;fontSize=16;labelPosition=center;verticalLabelPosition=middle;align=right;verticalAlign=top;" vertex="1" parent="1"><mxGeometry x="901" y="45" width="95" height="35" as="geometry" /></mxCell>' +
		'<mxCell id="rd_r3c1" value="" style="rounded=0;whiteSpace=wrap;html=1;fontFamily=Verdana;fontSize=16;labelPosition=center;verticalLabelPosition=middle;align=right;verticalAlign=top;" vertex="1" parent="1"><mxGeometry x="806" y="80" width="95" height="35" as="geometry" /></mxCell>' +
		'<mxCell id="rd_r3c2" value="" style="rounded=0;whiteSpace=wrap;html=1;fontFamily=Verdana;fontSize=16;labelPosition=center;verticalLabelPosition=middle;align=right;verticalAlign=top;" vertex="1" parent="1"><mxGeometry x="901" y="80" width="95" height="35" as="geometry" /></mxCell>' +
		'<mxCell id="rd_r4c1" value="" style="rounded=0;whiteSpace=wrap;html=1;fontFamily=Verdana;fontSize=16;labelPosition=center;verticalLabelPosition=middle;align=right;verticalAlign=top;" vertex="1" parent="1"><mxGeometry x="806" y="115" width="95" height="35" as="geometry" /></mxCell>' +
		'<mxCell id="rd_r4c2" value="" style="rounded=0;whiteSpace=wrap;html=1;fontFamily=Verdana;fontSize=16;labelPosition=center;verticalLabelPosition=middle;align=right;verticalAlign=top;" vertex="1" parent="1"><mxGeometry x="901" y="115" width="95" height="35" as="geometry" /></mxCell>' +
		'<mxCell id="contextGroup" style="group" vertex="1" connectable="0" parent="1"><mxGeometry x="1010" y="10" width="149" height="140" as="geometry" /></mxCell>' +
		'<mxCell id="contextOutline" style="rounded=0;whiteSpace=wrap;html=1;fillColor=none;fontFamily=Verdana;fontSize=11;" vertex="1" parent="contextGroup"><mxGeometry width="149" height="140" as="geometry" /></mxCell>' +
		'<mxCell id="contextCaption" value="CONTEXT:" style="text;html=1;align=left;verticalAlign=top;fontFamily=Verdana;fontSize=11;fontStyle=1;spacing=4;" vertex="1" parent="contextGroup"><mxGeometry width="149" height="20" as="geometry" /></mxCell>' +
		'<mxCell id="contextValue" value="—" style="rounded=0;whiteSpace=wrap;html=1;fontFamily=Verdana;fontSize=30;align=center;verticalAlign=middle;idef0Role=contextValue;" vertex="1" parent="contextGroup"><mxGeometry y="22" width="149" height="118" as="geometry" /></mxCell>' +
		'<mxCell id="node" value="" style="rounded=0;whiteSpace=wrap;html=1;fontFamily=Verdana;fontSize=16;align=center;verticalAlign=middle;idef0Role=nodeValue;" vertex="1" parent="1"><mxGeometry x="10" y="777" width="100" height="40" as="geometry" /></mxCell>' +
		'<mxCell id="title" value="TITLE: Название диаграммы" style="rounded=0;whiteSpace=wrap;html=1;fontFamily=Verdana;fontSize=16;idef0Role=titleValue;" vertex="1" parent="1"><mxGeometry x="120" y="777" width="929" height="40" as="geometry" /></mxCell>' +
		'<mxCell id="number" value="NUMBER: " style="rounded=0;whiteSpace=wrap;html=1;fontFamily=Verdana;fontSize=16;labelPosition=center;verticalLabelPosition=middle;align=right;verticalAlign=top;" vertex="1" parent="1"><mxGeometry x="1059" y="777" width="100" height="40" as="geometry" /></mxCell>' +
		'<mxCell id="taskGroup" style="group" vertex="1" connectable="0" parent="1"><mxGeometry x="485" y="404" width="200" height="120" as="geometry" /></mxCell>' +
		'<mxCell id="taskMain" value="" style="rounded=0;whiteSpace=wrap;html=1;shadow=1;shadowOpacity=50;shadowOffsetX=15;shadowColor=#363636;shadowBlur=1;shadowOffsetY=15;comic=0;enumerate=0;treeMoving=0;treeFolding=0;backgroundOutline=0;metaEdit=0;collapsible=0;dropTarget=0;container=0;fixDash=0;noLabel=0;fontFamily=Verdana;fontSize=14;labelPosition=center;verticalLabelPosition=middle;align=center;verticalAlign=middle;idef0Role=taskMain;" vertex="1" parent="taskGroup"><mxGeometry width="200" height="120" as="geometry" /></mxCell>' +
		'<mxCell id="stampChildCount" value="0" style="rounded=0;whiteSpace=wrap;html=1;fontFamily=Verdana;fontSize=11;align=center;verticalAlign=middle;idef0Role=stampChildCount;strokeColor=none;glass=1;opacity=0;" vertex="1" parent="taskGroup"><mxGeometry x="3" y="103" width="34" height="14" as="geometry" /></mxCell>' +
		'<mxCell id="stampLink" value="—" style="rounded=0;whiteSpace=wrap;html=1;fontFamily=Verdana;fontSize=11;align=center;verticalAlign=middle;idef0Role=stampLink;strokeColor=none;glass=1;opacity=0;" vertex="1" parent="taskGroup"><mxGeometry x="163" y="103" width="34" height="14" as="geometry" /></mxCell>' +
		'</root>' +
		'</mxGraphModel>';

	function generatePageId() {
		try {
			if (typeof Editor !== 'undefined' && typeof Editor.guid === 'function') return Editor.guid();
		} catch (e) {}
		try {
			if (typeof mxUtils.createGuid === 'function') return mxUtils.createGuid();
		} catch (e) {}
		return 'idef0-' + Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 8);
	}

	function buildBlankDiagramNode(name) {
		var doc = mxUtils.parseXml('<diagram>' + BLANK_PAGE_XML + '</diagram>');
		var diagramNode = doc.documentElement;
		diagramNode.setAttribute('id', generatePageId());
		diagramNode.setAttribute('name', name || 'Без названия');
		return diagramNode;
	}

	// Создаёт страницу из встроенного пустого шаблона (см. BLANK_PAGE_XML) -
	// основной способ для "Создать диаграмму процесса" с версии 0.0.7: НЕ
	// дублирует текущую страницу (значит, на новой странице не будет
	// лишних блоков задач/стрелок, унаследованных оттуда, откуда её
	// создавали), а собирает её из встроенного XML напрямую.
	function createBlankChildPage(name) {
		try {
			if (typeof mxUtils.parseXml !== 'function' || typeof DiagramPage !== 'function') return null;
			var diagramNode = buildBlankDiagramNode(name);
			var newPage = new DiagramPage(diagramNode);
			if (typeof ui.insertPage === 'function') {
				ui.insertPage(newPage, ui.pages.length);
			} else {
				ui.pages.push(newPage);
			}
			if (ui.pages.indexOf(newPage) === -1) return null;
			return newPage;
		} catch (e) {
			return null;
		}
	}

	// ---------- резервные способы (если пустой шаблон не удалось собрать) ----------
	// Три независимых способа продублировать текущую страницу, от наиболее
	// "штатного" к наиболее низкоуровневому - используются, только если
	// createBlankChildPage() выше не сработал (крайне маловероятно, но на
	// всякий случай оставлено как подстраховка с версии 0.0.6).

	// Способ 1: встроенное действие Extras/File -> Duplicate Page.
	function tryDuplicatePageViaAction() {
		try {
			if (ui.actions == null || ui.actions.get == null) return null;
			var action = ui.actions.get('duplicatePage');
			if (action == null || typeof action.funct !== 'function') return null;
			var pagesBefore = ui.pages.slice();
			action.funct();
			for (var i = 0; i < ui.pages.length; i++) {
				if (pagesBefore.indexOf(ui.pages[i]) === -1) return ui.pages[i];
			}
		} catch (e) {}
		return null;
	}

	// Способ 2: метод ui.duplicatePage(page) напрямую, в обход реестра Actions.
	function tryDuplicatePageViaMethod(sourcePage) {
		try {
			if (typeof ui.duplicatePage !== 'function') return null;
			var pagesBefore = ui.pages.slice();
			var result = ui.duplicatePage(sourcePage);
			if (result != null && ui.pages.indexOf(result) >= 0) return result;
			for (var i = 0; i < ui.pages.length; i++) {
				if (pagesBefore.indexOf(ui.pages[i]) === -1) return ui.pages[i];
			}
		} catch (e) {}
		return null;
	}

	// Способ 3: клонируем XML текущей страницы напрямую (тот же приём, что
	// и в createBlankChildPage, только источник - существующая страница, а
	// не встроенный пустой шаблон).
	function tryDuplicatePageViaXmlClone(sourcePage) {
		try {
			if (sourcePage.node == null || typeof sourcePage.node.cloneNode !== 'function') return null;
			if (typeof DiagramPage !== 'function') return null;

			var newNode = sourcePage.node.cloneNode(true);
			newNode.setAttribute('id', generatePageId());

			var newPage = new DiagramPage(newNode);

			if (typeof ui.insertPage === 'function') {
				ui.insertPage(newPage, ui.pages.length);
			} else {
				ui.pages.push(newPage);
			}

			if (ui.pages.indexOf(newPage) === -1) return null;
			return newPage;
		} catch (e) {
			return null;
		}
	}

	function duplicateCurrentPageRobust(sourcePage) {
		var viaAction = tryDuplicatePageViaAction();
		if (viaAction != null) return { page: viaAction, method: 'действие Extras (duplicatePage)' };

		var viaMethod = tryDuplicatePageViaMethod(sourcePage);
		if (viaMethod != null) return { page: viaMethod, method: 'метод ui.duplicatePage' };

		var viaXml = tryDuplicatePageViaXmlClone(sourcePage);
		if (viaXml != null) return { page: viaXml, method: 'клонирование XML страницы' };

		return null;
	}

	// ---------- действие 4: создать диаграмму процесса из блока задачи ----------
	// Вызывается из контекстного меню правого клика на блоке задачи.
	// 1) Если у блока уже есть ссылка на существующую страницу - предлагает
	//    перейти на неё (чтобы не плодить дубликаты). Если ссылка есть, но
	//    страница по ней не находится (устаревшая/битая ссылка) - явно
	//    спрашивает подтверждение перед созданием новой.
	// 2) Иначе создаёт новую страницу из пустого шаблона (см.
	//    createBlankChildPage; резервный способ - дублирование текущей
	//    страницы, см. duplicateCurrentPageRobust), сразу вычисляет и
	//    проставляет её NODE (родитель уже точно известен - это не
	//    унаследованная ссылка, а только что установленная), TITLE (из
	//    подписи блока-инициатора), AUTHOR/PROJECT (с родительской
	//    страницы) и имя вкладки (равное вычисленному NODE), связывает
	//    исходный блок задачи с новой страницей и переключается на неё.

	function createChildDiagramFor(taskCell) {
		autoSyncInProgress = true;
		try {
			var graph = ui.editor.graph;

			if (typeof ui.selectPage !== 'function' || typeof graph.setLinkForCell !== 'function') {
				mxUtils.alert('Автоматическое создание страницы недоступно в этой версии draw.io. Создайте страницу вручную (Duplicate) и настройте ссылки - см. instructions.md, раздел 7.');
				return;
			}

			var existingLink = graph.getLinkForCell(taskCell);
			var existingTargetId = pageIdFromLink(existingLink);
			if (existingTargetId != null) {
				var existingPage = findPageById(existingTargetId);
				if (existingPage != null) {
					if (confirmDialog('У этого блока уже есть диаграмма-декомпозиция («' + getPageName(existingPage) + '»). Перейти на неё?')) {
						ui.selectPage(existingPage);
					}
					return;
				}
				// ссылка есть, но страница по ней не находится (устаревший id
				// или страница была удалена) - не считаем блок "свободным"
				// молча, спрашиваем явно
				if (!confirmDialog(
					'У этого блока уже задана ссылка на страницу, но такая страница в файле не найдена ' +
						'(возможно, устаревшая или битая ссылка). Создать новую диаграмму-декомпозицию для этого блока? ' +
						'Старая ссылка будет заменена новой.'
				)) {
					return;
				}
			}

			var taskLabel = trim(graph.convertValueToString(taskCell));
			var parentPage = ui.currentPage;
			var parentId = getPageId(parentPage);

			var parentNodeRes = readRoleValue(parentPage, 'nodeValue');
			var parentNode = (!parentNodeRes.unsupported && parentNodeRes.value) ? trim(parentNodeRes.value) : null;
			var newNode = parentNode ? computeChildNodeForParent(parentPage, parentNode, null) : null;
			var pageName = newNode || 'Без названия';

			var newPage = createBlankChildPage(pageName);
			var creationMethod = 'пустой шаблон (один блок процесса)';
			if (newPage == null) {
				var duplicated = duplicateCurrentPageRobust(parentPage);
				if (duplicated != null) {
					newPage = duplicated.page;
					creationMethod = 'дублирование текущей страницы (' + duplicated.method + ') - резервный способ, шаблон был недоступен';
				}
			}

			if (newPage == null) {
				mxUtils.alert(
					'Не удалось автоматически создать страницу ни одним из известных плагину способов ' +
						'(включая встроенный пустой шаблон). Создайте страницу вручную ' +
						'(правой кнопкой по вкладке страницы -> Duplicate) и настройте ссылки - см. instructions.md, раздел 7.'
				);
				return;
			}

			if (newPage === parentPage) {
				mxUtils.alert('Не удалось автоматически определить новую страницу. Настройте её вручную - см. instructions.md, раздел 7.');
				return;
			}

			setPageName(newPage, pageName);

			withPage(newPage, function (g) {
				var nodeCells = findCellsByRole(g, 'nodeValue');
				for (var n = 0; n < nodeCells.length; n++) g.cellLabelChanged(nodeCells[n], newNode || '', false);

				var titleCells = findCellsByRole(g, 'titleValue');
				for (var t = 0; t < titleCells.length; t++) {
					g.cellLabelChanged(titleCells[t], taskLabel ? ('TITLE: ' + taskLabel) : PLACEHOLDER_TITLE, false);
				}

				var usedAtCells = findCellsByRole(g, 'usedAtValue');
				for (var u = 0; u < usedAtCells.length; u++) {
					g.setLinkForCell(usedAtCells[u], 'data:page/id,' + parentId);
					g.cellLabelChanged(usedAtCells[u], parentNode || '—', false);
				}

				// перенести AUTHOR/PROJECT (и любые другие роли из SYNCED_ROLES)
				// с родительской страницы - чтобы не заполнять их заново вручную
				for (var r = 0; r < SYNCED_ROLES.length; r++) {
					var role = SYNCED_ROLES[r];
					var srcRes = readRoleValue(parentPage, role);
					if (!srcRes.unsupported && srcRes.value != null) {
						var targetCells = findCellsByRole(g, role);
						for (var tc = 0; tc < targetCells.length; tc++) {
							g.cellLabelChanged(targetCells[tc], srcRes.value, false);
						}
					}
				}

				// на пустом шаблоне ссылок/меток у блоков задач по построению и
				// так нет, но если страница создана резервным способом
				// (клонирование текущей страницы) - сбрасываем их, как раньше
				var mainsNew = findCellsByRole(g, 'taskMain');
				for (var m = 0; m < mainsNew.length; m++) g.setLinkForCell(mainsNew[m], null);

				var linkStampsNew = findCellsByRole(g, 'stampLink');
				for (var l = 0; l < linkStampsNew.length; l++) g.cellLabelChanged(linkStampsNew[l], '—', false);

				var countStampsNew = findCellsByRole(g, 'stampChildCount');
				for (var c = 0; c < countStampsNew.length; c++) g.cellLabelChanged(countStampsNew[c], '0', false);
			});

			graph.setLinkForCell(taskCell, 'data:page/id,' + getPageId(newPage));

			// самопроверка: ссылка действительно указывает на созданную страницу?
			var verifyId = pageIdFromLink(graph.getLinkForCell(taskCell));
			var actualNewId = getPageId(newPage);
			var idWarning = (verifyId !== actualNewId)
				? ('\n\nВНИМАНИЕ: после создания страницы id ссылки не совпал с id страницы (' + verifyId + ' vs ' + actualNewId +
					') - если переход по ссылке не сработает, свяжите вручную через Edit Link.')
				: '';

			ui.selectPage(newPage);
			notify(
				'Страница «' + getPageName(newPage) + '» создана и связана с блоком' +
					(newNode ? (', NODE = ' + newNode) : '') + ' (способ: ' + creationMethod + ').' + idWarning
			);
		} finally {
			autoSyncInProgress = false;
		}
	}

	// Добавляет пункт "IDEF0: Создать диаграмму процесса" в контекстное меню
	// (правый клик) для блока задачи (taskMain) или для ЛЮБОГО контейнера,
	// внутри которого он лежит (обычно это группа блока задачи, но с версии
	// 0.0.6 это не обязано быть помечено какой-то отдельной ролью - ищем
	// taskMain рекурсивно внутри того, по чему кликнули). Обёрнуто в
	// try/catch, чтобы ошибка здесь не ломала стандартное контекстное меню
	// draw.io.
	var oldPopupFactory = ui.editor.graph.popupMenuHandler.factoryMethod;

	ui.editor.graph.popupMenuHandler.factoryMethod = function (menu, cell, evt) {
		oldPopupFactory.apply(this, arguments);
		try {
			var effectiveTaskCell = null;
			if (cell != null && cell.style != null && styleHasRole(cell.style, 'taskMain')) {
				effectiveTaskCell = cell;
			} else if (cell != null) {
				var innerMains = findCellsByRole(ui.editor.graph, 'taskMain', cell);
				if (innerMains.length > 0) effectiveTaskCell = innerMains[0];
			}
			if (effectiveTaskCell != null) {
				menu.addSeparator();
				menu.addItem('IDEF0: Создать диаграмму процесса', null, function () {
					createChildDiagramFor(effectiveTaskCell);
				});
			}
		} catch (e) {
			// не ломаем стандартное контекстное меню, если что-то пошло не так
		}
	};

	// ---------- регистрация действий и пунктов меню ----------

	ui.actions.addAction('idef0UpdateNodes', updateNodesAndStamps);
	ui.actions.addAction('idef0StampDate', stampVersionDate);
	ui.actions.addAction('idef0SyncFields', syncFields);
	ui.actions.addAction('idef0ToggleNotifications', toggleNotifications);
	ui.actions.addAction('idef0ToggleAutoSync', toggleAutoSyncStamps);

	if (mxResources.parse != null) {
		mxResources.parse(
			'idef0UpdateNodes=IDEF0: Обновить узлы, метки и TITLE\n' +
				'idef0StampDate=IDEF0: Проставить дату версии\n' +
				'idef0SyncFields=IDEF0: Синхронизировать поля (с этой страницы)\n' +
				'idef0ToggleNotifications=IDEF0: Уведомления о выполненных действиях (вкл/выкл)\n' +
				'idef0ToggleAutoSync=IDEF0: Автообновление угловых меток (вкл/выкл)\n'
		);
	}

	var menu = ui.menus.get('extras');
	var oldFunct = menu.funct;

	menu.funct = function (menu2, parent) {
		oldFunct.apply(this, arguments);
		ui.menus.addMenuItems(menu2, [
			'-',
			'idef0UpdateNodes',
			'idef0StampDate',
			'idef0SyncFields',
			'-',
			'idef0ToggleNotifications',
			'idef0ToggleAutoSync'
		]);
	};
});
