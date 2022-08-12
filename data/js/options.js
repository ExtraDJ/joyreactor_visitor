let is_num = function(number) {
	if (number === null || number === undefined)
		return false;

	number = parseInt(number);
	return (typeof number == 'number' && !isNaN(number));
};
let isFirefox = function() {
	if (typeof browser !== 'undefined' && typeof chrome.runtime !== 'undefined') { return true; }
	return false;
};
// document loaded
document.addEventListener('DOMContentLoaded', async function(e) {
	if (!isFirefox()) {
		document.querySelector('[name="depth"]').nextElementSibling.style.display = 'none';
		document.querySelector('[name="opacity"]').nextElementSibling.style.display = 'none';
	}

	// get current options
	let options = (await chrome.storage.sync.get({
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
		switch (key) {
			case 'tags':
				document.querySelector('[name="'+key+'"]').innerText = value;
				break;
			case 'pager':
			case 'exceptions':
				document.querySelector('[name="'+key+'"][value="'+value+'"]').click();
				break;
			case 'post':
				document.querySelector('[name="'+key+'"][value="'+value+'"]').click();
				if (value.includes('translucent')) {
					document.getElementById('opacity').classList.remove('hide');
				}
				break;
			case 'opacity':
				document.querySelector('[name="'+key+'"]').value = Math.round((1 - value)*100);
				document.querySelector('[name="'+key+'"]').title = Math.round((1 - value)*100)+'%';
				document.querySelector('[name="'+key+'"]').nextElementSibling.innerText = Math.round((1 - value)*100)+'%';
				break;
			case 'depth':
				var title;
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

				document.querySelector('[name="'+key+'"]').value = value;
				document.querySelector('[name="'+key+'"]').title = title;
				document.querySelector('[name="'+key+'"]').nextElementSibling.innerText = title;
				break;
		}
	}

	// when any change
	document.addEventListener('input', async function(event) {
		let key = event.target.getAttribute('name');
		let value = event.target.value;

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
				document.querySelector('[name="'+key+'"]').title = value+'%';
				document.querySelector('[name="'+key+'"]').nextElementSibling.innerText = value+'%';
				options[key] = (100 - value)/100;
				break;
			case 'depth':
				var title;
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

				options[key] = parseInt(value);
				document.querySelector('[name="'+key+'"]').title = title;
				document.querySelector('[name="'+key+'"]').nextElementSibling.innerText = title;
				break;
			case 'import':
				const reader = new FileReader();
				reader.addEventListener('load', function(e) {
					let data = {};
					// read per line
					let list = reader.result.split('\n');
					for (var i in list) {
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

	document.getElementById('export').addEventListener('click', async function(event) {
		// get all data
		let content = await new Promise(function(resolve, reject) {

			var result = [];

			chrome.storage.local.get(null, function(object, error) {
				let list = Object.values(object);
				if (list.length > 0) {
					do {
						let item = list.shift();
						result.push(item.id+':'+item.added);
					} while (list.length > 0);
				}

				resolve(result);
			});
		});
		// content
		let doc = URL.createObjectURL(new Blob([content.join("\n")]));
		// filename
		const padL = (nr, len = 2, chr = `0`) => `${nr}`.padStart(2, chr);
		var d = new Date;
		let filename = 'joyreactor_'+[padL(d.getMonth()+1), padL(d.getDate()), d.getFullYear()].join('_')+'_'+[padL(d.getHours()), padL(d.getMinutes()), padL(d.getSeconds())].join('_')+'.txt';
		// download
		chrome.downloads.download({
			url: doc, 
			filename: filename, 
			conflictAction: 'overwrite'
		});
	});
});

