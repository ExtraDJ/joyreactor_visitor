function is_num(number) {
	if (number === null || number === undefined)
		return false;

	number = parseInt(number);
	return (typeof number == 'number' && !isNaN(number));
}
function is_firefox() {
	if (typeof browser !== 'undefined' && typeof chrome.runtime !== 'undefined') { return true; }
	return false;
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
// document loaded
document.addEventListener('DOMContentLoaded', async function() {
	// firefox range input
	if (!is_firefox()) {
		document.querySelector('[name="depth"]').nextElementSibling.style.display = 'none';
		document.querySelector('[name="opacity"]').nextElementSibling.style.display = 'none';
	}

	// get current options
	const options = (await chrome.storage.sync.get({
		options: {
			tags: '',
			exceptions: 'tag',
			pager: 'withoutfirst',
			post: 'hide',
			opacity: 0.6,
			depth: 3
		}
	})).options;
	
	// display current options
	for (const [key, value] of Object.entries(options)) {
		let title;

		switch (key) {
			case 'tags':
				document.querySelector(`[name="${key}"]`).innerText = value;
				break;
			case 'pager':
			case 'exceptions':
				document.querySelector(`[name="${key}"][value="${value}"]`).click();
				break;
			case 'post':
				document.querySelector(`[name="${key}"][value="${value}"]`).click();
				if (value.includes('translucent')) {
					document.getElementById('opacity').classList.remove('hide');
				}
				break;
			case 'opacity':
				document.querySelector(`[name="${key}"]`).value = Math.round((1 - value)*100);
				document.querySelector(`[name="${key}"]`).title = Math.round((1 - value)*100)+'%';
				document.querySelector(`[name="${key}"]`).nextElementSibling.innerText = Math.round((1 - value)*100)+'%';
				break;
			case 'depth':
				title = depthTitle(value);

				document.querySelector(`[name="${key}"]`).value = value;
				document.querySelector(`[name="${key}"]`).title = title;
				document.querySelector(`[name="${key}"]`).nextElementSibling.innerText = title;
				break;
		}
	}

	// when any change
	document.addEventListener('input', async function(event) {
		const key = event.target.getAttribute('name');
		const value = event.target.value;
		let title;

		const reader = new FileReader();

		switch (key) {
			case 'tags':
			case 'pager':
			case 'exceptions':
				options[key] = value;
				break;
			case 'post':
				options[key] = value;
				if (value.includes('translucent')) {
					document.getElementById('opacity').classList.remove('hide');
				} else {
					document.getElementById('opacity').classList.add('hide');
				}
				break;
			case 'opacity':
				document.querySelector(`[name="${key}"]`).title = value+'%';
				document.querySelector(`[name="${key}"]`).nextElementSibling.innerText = value+'%';
				options[key] = (100 - value)/100;
				break;
			case 'depth':
				title = depthTitle(value);

				options[key] = parseInt(value);
				document.querySelector(`[name="${key}"]`).title = title;
				document.querySelector(`[name="${key}"]`).nextElementSibling.innerText = title;
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
								id: parseInt(item[0]),
								added: parseInt(item[1])
							};
						}
					}
					// set all
					chrome.storage.local.set(data);
				});

				reader.readAsText(event.target.files[0]);
				break;
		}

		// save
		await chrome.storage.sync.set({options: options});
	});

	// export
	document.getElementById('export').addEventListener('click', async function() {
		// get all data
		const content = await new Promise(function(resolve) {

			const result = [];

			chrome.storage.local.get(null, function(object) {
				const list = Object.values(object);
				if (list.length > 0) {
					do {
						let item = list.shift();
						// post_id:added (unix)
						result.push(`${item.id}:${item.added}`);
					} while (list.length > 0);
				}

				resolve(result);
			});
		});
		// content
		const file = URL.createObjectURL(new Blob([content.join("\n")]));
		// filename
		const padL = function(nr, chr = `0`) { return `${nr}`.padStart(2, chr) };
		const d = new Date;
		const filename = 'joyreactor_'+[padL(d.getMonth()+1), padL(d.getDate()), d.getFullYear()].join('_')+'_'+[padL(d.getHours()), padL(d.getMinutes()), padL(d.getSeconds())].join('_')+'.txt';
		// download
		chrome.downloads.download({
			url: file, 
			filename: filename, 
			conflictAction: 'overwrite'
		});
	});
});

