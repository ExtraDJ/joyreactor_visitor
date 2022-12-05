var $options = {};

async function startUp() {
	const regexp = new RegExp("(http|https)://[a-zA-Z0-9-.]*(reactor|jr-proxy|jrproxy)[a-z.]+/post/([0-9]+)[/]{0,1}");
	// get all history. check by url, because multidomain, but single engine and database
	chrome.history.search({'text': '/post/', 'maxResults': 1000000, 'startTime': 0}, function(visits) {
		if (visits.length > 0) {
			do {
				let item = visits.shift();
				// check full url
				let match = item.url.match(regexp);

				if (match) {
					let data = {};
					data[match[3]] = {
						id: parseInt(match[3]),
						added: parseInt(Math.floor(item.lastVisitTime/1000))
					};

					chrome.storage.local.set(data);
				}
			} while (visits.length > 0);
		}
	});
}
async function getOptions() {
	// get options with default data
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

	// string to array
	options.tags = options.tags.split(',').map(function(tag) {
		// protect from edvard ruki penisy
		return tag.trim();
	});

	return options;
}
async function getStatus() {
	return (await chrome.storage.sync.get({enabled: true})).enabled;
}
async function setStatus(status) {
	await chrome.storage.sync.set({enabled: status});

	if (status) {
		chrome.action.setIcon({path: '../images/enabled.png'});
	} else {
		chrome.action.setIcon({path: '../images/disabled.png'});
	}
}
async function check(ids) {
	return new Promise(function(resolve) {

		let offset;
		switch (parseInt($options.depth)) {
			case 0: // 24 h
				offset = Math.floor(Date.now() / 1000) - (60*60*24);
				break;
			case 1: // 1 week
				offset = Math.floor(Date.now() / 1000) - (60*60*24*7);
				break;
			case 2: // 2 week
				offset = Math.floor(Date.now() / 1000) - (60*60*24*14);
				break;
			case 3: // 1 month
				offset = Math.floor(Date.now() / 1000) - (60*60*24*30);
				break;
			case 4: // 6 months
				offset = Math.floor(Date.now() / 1000) - (60*60*24*180);
				break;
			case 5: // without limits
				offset = 0;
				break;
		}

		const result = [];

		// get all data from storage
		chrome.storage.local.get(ids, function(object) {
			const list = Object.values(object);
			if (list.length > 0) {
				do {
					let item = list.shift();
					if (item.added > offset) {
						result.push(item.id);
					}
				} while (list.length > 0);
			}

			resolve(result);
		});
	});
}

chrome.runtime.onMessage.addListener(async function(request, sender, sendResponse) {
	sendResponse(true);

	// permanently save to ram
	if (Object.keys($options).length == 0)
		$options = await getOptions();

	// tmp object
	let data = {};
	
	switch (request.action) {
		case 'start': // check to start
			if (await getStatus()) { // reply only if extension enabled
				chrome.tabs.sendMessage(sender.tab.id, {action: 'start', data: $options});
			}
			break;
		case 'check': // chech posts in storage
			chrome.tabs.sendMessage(sender.tab.id, {action: 'check', data: await check(request.data)});
			break;
		case 'mark': // mark post as viewed
			data[request.data] = {
				id: parseInt(request.data),
				added: parseInt(Math.floor(Date.now() / 1000))
			}

			chrome.storage.local.set(data);
			break;
	}

	return true;
});

chrome.runtime.onInstalled.addListener(async function() {
	// import data from history to storage
	startUp();
	setStatus(await getStatus());
});
chrome.runtime.onStartup.addListener(async function() {
	// import data from history to storage
	startUp();
	setStatus(await getStatus());
});
chrome.storage.sync.onChanged.addListener(async function() {
	$options = await getOptions();
});

// toggle enable status
chrome.action.onClicked.addListener(async function() {
	const enabled = await getStatus();

	if (enabled) { // if enabled
		setStatus(false);
	} else {
		setStatus(true);
	}

	// send reload
	chrome.tabs.query({
		active: true, 
		url: chrome.runtime.getManifest()['content_scripts'][0]['matches']
	}, function(tabs) {
		for (var i in tabs) {
			chrome.tabs.sendMessage(tabs[i].id, {action: 'reload'});
		}
	});
});
