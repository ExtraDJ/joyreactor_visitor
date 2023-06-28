const engine = (function() {
	if (typeof browser !== 'undefined') {
		return browser;
	}
	return chrome;
})();

const is_firefox = (function() {
	if (typeof browser !== 'undefined') {
		return true;
	}
	return false;
})();

function is_num(number) {
	if (number === null || number === undefined)
		return false;

	number = parseInt(number);
	return (typeof number == 'number' && !isNaN(number));
}
function depthTitle(value) {
	let title;
	switch (parseInt(value)) {
		case 0:
			title = 'Сутки';
			break;
		case 1:
			title = 'Неделя';
			break;
		case 2:
			title = '2 Недели';
			break;
		case 3:
			title = 'Месяц';
			break;
		case 4:
			title = '6 Месяцев';
			break;
		case 5:
			title = 'Без ограничений';
			break;
	}

	return title;
}

var options = {};

// document loaded
$(window).on('load', function() {

	// firefox range input
	if (!is_firefox) {
		$('[name="extension_depth"], [name="post_opacity"]').siblings('span').css('display', 'none');
	}

	engine.runtime.onMessage.addListener(async function(request, sender) {
		// messages only from service worker
		if (typeof sender.tab === 'object')
			return;

		if (request.method == 'options' && typeof request.options === 'object') {
			options = request.options;
			
			for (let [key, value] of Object.entries(options)) {
				switch (key) {
					case 'extension_ignore_url':
						$(`[name="${key}"]`).val(value.join(', '));
						break;
					case 'tags_list':
						if (!Array.isArray(value))
							value = Object.keys(value);

						$(`[name="${key}"]`).val(value.join(', '));
						break;
					case 'sync_key':
						$(`[name="${key}"]`).val(value);
						if (value) {
							$('#sync_get, #sync_set').removeClass('hide');
						} else {
							$('#sync_get, #sync_set').addClass('hide');
						}
						break;
					case 'download_folder':
					case 'download_prefix':
						$(`[name="${key}"]`).val(value);
						break;
					case 'post_pages_action':
						$(`[name="${key}"][value="${value}"]`).click();
						if (value.includes('translucent')) {
							$('#post_opacity').removeClass('hide');
						}
						break;
					case 'post_opacity':
						$(`[name="${key}"]`).val(Math.round((1 - value)*100)).attr('title', Math.round((1 - value)*100)+'%').siblings('span').text(Math.round((1 - value)*100)+'%');
						break;
					case 'extension_depth':
						let title = depthTitle(value);
						$(`[name="${key}"]`).val(value).attr('title', title).siblings('span').text(title);
						break;
					default:
						$(`[name="${key}"][value="${value}"]`).click();
						break;
				}
			}
		}
	});
	// request options from service worker
	engine.runtime.sendMessage({method: 'options'});

	// when any change
	$(document).on('input', async function(event) {
		const key = event.target.getAttribute('name');
		let value = event.target.value;

		const reader = new FileReader();
		switch (key) {
			case 'sync_key':
				if (value) {
					$('#sync_get, #sync_set').removeClass('hide');
				} else {
					$('#sync_get, #sync_set').addClass('hide');
				}
				options[key] = value;
				break;
			case 'extension_ignore_url':
			case 'tags_list':
				let list = [];
				value = value.split(',').map(function(item) {
					return item.trim();
				}).filter(function(item) {
					return item;
				});
				for (let item of value) {
					list.push(item);
				}
				options[key] = list;
				break;
			case 'download_folder':
				let path = value.split('/').map(function(path) {
					return path.trim();
				}).filter(function(path) {
					return path;
				});

				path = path.join('/')
				if (path.length) { path += '/'; }

				options[key] = path;
				break;
			case 'download_prefix':
				options[key] = value.trim().replace('/', '');
				break;
			case 'post_action':
				options[key] = value;
				if (value.includes('translucent')) {
					$('#post_opacity').removeClass('hide');
				} else {
					$('#post_opacity').addClass('hide');
				}
				break;
			case 'post_opacity':
				value = parseInt(value);
				options[key] = (100 - value)/100;

				$(`[name="${key}"]`).val(value).attr('title', `${value}%`).siblings('span').text(`${value}%`);
				break;
			case 'extension_depth':
				value = parseInt(value);
				options[key] = value;

				let title = depthTitle(value);
				$(`[name="${key}"]`).val(value).attr('title', title).siblings('span').text(title);
				break;
			case 'import':
				reader.addEventListener('load', function() {
					var data = {};
					// read per line
					const list = reader.result.split('\n');
					for (const i in list) {
						// post_id:added (unix)
						let item = list[i].split(':');
						if (is_num(item[0]) && is_num(item[1])) {
							data[item[0]] = {
								post_id: parseInt(item[0]),
								added: parseInt(item[1])
							};
						}
					}
					// set all
					engine.storage.local.set(data);
				});

				reader.readAsText(event.target.files[0]);
				break;
			default:
				if (value.match(/([0-9]+)/)) {
					options[key] = parseInt(value);
				} else {
					options[key] = value.trim();
				}
				break;
		}

		// save
		await engine.storage.sync.set({options: options});
	});
	$(document).on('click', 'button', async function() {
		switch ($(this).attr('id')) {
			case 'sync_get':
				engine.runtime.sendMessage({method: 'sync', action: 'get'});
				break;
			case 'sync_set':
				engine.runtime.sendMessage({method: 'sync', action: 'set'});
				break;
			case 'reset': // reset options
				if (confirm('Вы уверены что хотите сбросить настройки?')) {
					engine.storage.sync.clear(function() {
						window.location.reload();
					});
				}
				break;
			case 'clear': // clear history
				if (confirm('Вы уверены что хотите очистить историю просмотра?')) {
					engine.runtime.sendMessage({method: 'sync', action: 'clear'});
					engine.storage.local.get(null, function(data) {
						let remove = [];
						for (const post_id in data) {
							// if this post data
							if (is_num(post_id))
								remove.push(post_id);
						}
						engine.storage.local.remove(remove, function() {
							window.location.reload();
						});
					});
				}
				break;
			case 'cache': // clear cache
				if (confirm('Вы уверены что хотите очистить кеш?')) {
					engine.runtime.sendMessage({method: 'posts', action: 'cache'});
				}
				break;
			case 'clearall':
				if (confirm('Вы уверены что хотите очистить настройки и историю?')) {
					engine.runtime.sendMessage({method: 'sync', action: 'clearall'});
					engine.storage.sync.clear(function() {
						engine.storage.local.get(null, function(data) {
							let remove = [];
							for (const post_id in data) {
								// if this post data
								if (is_num(post_id))
									remove.push(post_id);
							}
							engine.storage.local.remove(remove, function() {
								window.location.reload();
							});
						});
					});
				}
				break;
			case 'export': // export history
				const content = await new Promise(function(resolve) {

					const result = [];

					engine.storage.local.get(null, function(object) {
						const list = Object.values(object);
						if (list.length > 0) {
							while(list.length) {

								let item = list.shift();
								if (!is_num(item.post_id))
									continue;

								// post_id:added (unix)
								result.push(`${item.post_id}:${item.added}`);
							}
						}

						resolve(result);
					});
				});

				// content
				const file = URL.createObjectURL(new Blob([content.join("\n")]));
				// filename
				const filename = `JV_${new Date().toLocaleString('uk-UA').replaceAll(/([,.: ])/g, '_')}.txt`;
				// download
				engine.downloads.download({
					url: file, 
					filename: filename, 
					conflictAction: 'overwrite'
				});
				break;
		}
	})
});