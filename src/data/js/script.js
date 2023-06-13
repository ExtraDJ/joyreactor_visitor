const getEngine = function() {
	if (typeof browser !== 'undefined') {
		browser.action = browser.browserAction;
		return browser;
	}
	return chrome;
}
const engine = getEngine();

class JV {
	constructor() {
		this.options = {};
		this.links = {};
		this.redirects = {};
	}
	async init() {
		const $this = this;

		$this.options = await $this.getOptions();

		if (engine.runtime.getManifest().manifest_version == 3) {
			$this.rulesV3();
		} else {
			$this.rulesV2();
		}

		$this.handler();
	}
	handler() {
		const $this = this;

		engine.runtime.onMessage.addListener(async function(request, sender) {				
			
			switch (request.action) {
				case 'tag': // tag page
					let params;
					let url;
					if (sender.tab.id in $this.redirects) { // we have redirects?
						url = $this.redirects[sender.tab.id];
						delete $this.redirects[sender.tab.id];
					} else {
						url = request.url;
					}
					if (!url) { return false; }

					params = new URL(url).pathname.split('/');

					const tag = decodeURI(params[2]);
					let type = 'good';
					let page = 0;

					if (params.length == 4) {
						const last = params.at(-1);
						if (isNaN(parseInt(last))) {
							type = last;
						} else {
							page = parseInt(last);
						}
					}

					if (params.length > 4) {
						page = parseInt(params.at(-1));
						type = params.at(-2);
					}

					let path = `/tag/${tag}`;
					if (type !== 'good')
						path += `/${type}`

					engine.tabs.sendMessage(sender.tab.id, {
						action: 'tag', 
						data: await $this.getTag(tag.replace('+', ' '), type, page),
						type: type,
						page: page,
						path: path,
						url: decodeURI(url)
					});
					break;
				case 'start': // check to start
					engine.tabs.sendMessage(sender.tab.id, {action: 'start', data: $this.options});
					break;
				case 'check': // chech posts in storage
					if ($this.options.post == 'none' || !await $this.getStatus()) {
						engine.tabs.sendMessage(sender.tab.id, {action: 'check', data: []});
					} else {
						engine.tabs.sendMessage(sender.tab.id, {action: 'check', data: await $this.check(request.data)});
					}
					break;
				case 'mark': // mark post as viewed
					engine.storage.local.get([request.data], function(data) {
						if (!(request.data in data))
							data[request.data] = {};
						
						Object.assign(data[request.data], {
							id: parseInt(request.data),
							added: parseInt(Math.floor(Date.now() / 1000))
						});

						engine.storage.local.set(data);
					});
					break;
				case 'unlock':
					engine.tabs.sendMessage(sender.tab.id, {action: 'unlock', data: await $this.unlock(request.data)});
					break;
				case 'download':
					if (engine.runtime.getManifest().manifest_version == 3) {
						engine.downloads.download({
							url: request.data.data, 
							filename: `${$this.options.download_folder}/${request.data.filename}`,
							conflictAction: 'overwrite'
						});
					} else {
						engine.downloads.download({
							url: request.data.url, 
							headers: [
								{name: 'Referer', value: 'https://joyreactor.cc/'}
							],
							filename: `${$this.options.download_folder}/${request.data.filename}`,
							conflictAction: 'overwrite'
						});
					}
					break;
			}

			return true;
		});
		engine.runtime.onInstalled.addListener(async function() {
			// import data from history to storage
			$this.startUp();
			$this.setStatus(await $this.getStatus());
		});
		engine.runtime.onStartup.addListener(async function() {
			// import data from history to storage
			$this.startUp();
			$this.setStatus(await $this.getStatus());
		});
		engine.storage.sync.onChanged.addListener(async function() {
			$this.options = await $this.getOptions();
		});
		engine.action.onClicked.addListener(async function() {
			const enabled = await $this.getStatus();

			if (enabled) { // if enabled
				$this.setStatus(false);
			} else {
				$this.setStatus(true);
			}

			// send reload
			engine.tabs.query({
				active: true, 
				url: engine.runtime.getManifest()['content_scripts'][0]['matches']
			}, function(tabs) {
				for (const i in tabs) {
					engine.tabs.sendMessage(tabs[i].id, {action: 'reload'});
				}
			});
		});
	}
	rulesV3() {
		const $this = this;

		const rules = [
			{
				id: 1,
				priority: 1,
				action: {
					type: 'modifyHeaders',
					requestHeaders: [
						{ header: 'Origin', operation: 'set', value: 'https://api.joyreactor.cc' },
						{ header: 'Content-Type', operation: 'set', value: 'application/json' }
					],
					responseHeaders: [
						{ header: 'Access-Control-Allow-Headers', operation: 'set', value: 'Content-Type' },
						{ header: 'Access-Control-Allow-Origin', operation: 'set', value: '*' }
					]
				},
				condition: {
					urlFilter: 'https://api.joyreactor.cc/graphql?JV=1',
					resourceTypes: ['xmlhttprequest']
				}
			},
			{
				id: 2,
				priority: 1,
				action: {
					type: 'allow'
				},
				condition: {
					urlFilter: '*/tag/*',
					resourceTypes: ['main_frame']
				}
			},
			{
				id: 3,
				priority: 1,
				action: {
					type: 'redirect',
					redirect: {
						transform: {
							path: '',
							fragment: '#JV=tag'
						}
					}
				},
				condition: {
					urlFilter: '/images/censorship/*',
					resourceTypes: ['main_frame']
				}
			},
			{
				id: 4,
				priority: 1,
				action: {
					type: 'modifyHeaders',
					requestHeaders: [
						{ header: 'Referer', operation: 'set', value: 'https://joyreactor.cc/' }
					],
					responseHeaders: [
						{ header: 'Access-Control-Allow-Origin', operation: 'set', value: '*' }
					]
				},
				condition: {
					urlFilter: '/pics/post/*',
					resourceTypes: ['xmlhttprequest']
				}
			}
		];

		engine.declarativeNetRequest.getSessionRules({}, function(event) {
			if (event.length !== rules.length)
				engine.declarativeNetRequest.updateSessionRules({addRules: rules, removeRuleIds: []}, function() {});
		});
		engine.webRequest.onBeforeRequest.addListener(
			function(event) {
				if (event.url.match(/tag/))
					$this.links[event.requestId] = event.url;

				if (event.url.match(/censorship/)) {
					if (event.requestId in $this.links) {
						$this.redirects[event.tabId] = $this.links[event.requestId];
					}
				}
			},
			{
				urls: ['<all_urls>'],
				types: ['main_frame']
			}
		);
	}
	rulesV2() {
		const $this = this;

		engine.webRequest.onBeforeSendHeaders.addListener(
			function(details) {
				let headers = details.requestHeaders;
				for (var i = 0, l = headers.length; i < l; ++i) {
					if (headers[i].name == 'Origin') {
						headers[i].value = "https://api.joyreactor.cc";
						break;
					}
				}
				headers.push({name: 'Content-Type', value: 'application/json'});
				return {requestHeaders: headers};
			},
			{
				urls: ['https://api.joyreactor.cc/graphql?JV=1'],
				types: ['xmlhttprequest']
			},
			['requestHeaders', 'blocking']
		);
		engine.webRequest.onBeforeRequest.addListener(
			function(event) {
				if (event.url.match(/tag/))
					$this.links[event.requestId] = event.url;

				if (event.url.match(/censorship/)) {
					if (event.requestId in $this.links) {
						$this.redirects[event.tabId] = $this.links[event.requestId];
					}
					return {
						redirectUrl: `${new URL(event.originUrl).origin}#JV=tag`
					};
				}
			},
			{
				urls: ['<all_urls>'],
				types: ['main_frame']
			},
			['blocking']
		);
	}
	async startUp() {
		const regexp = new RegExp("(http|https)://[a-zA-Z0-9-.]*(reactor|jr-proxy|jrproxy)[a-z.]+/post/([0-9]+)[/]{0,1}");
		// get all history. check by url, because multidomain, but single engine and database
		engine.storage.local.get(null, function(exists) {
			engine.history.search({'text': '/post/', 'maxResults': 1000000, 'startTime': 0}, function(visits) {
				if (visits.length > 0) {
					do {
						const item = visits.shift();
						// check full url
						const match = item.url.match(regexp);

						if (match) {
							let data = {};

							if (match[3] in exists)
								continue;

							data[match[3]] = {
								id: parseInt(match[3]),
								added: parseInt(Math.floor(item.lastVisitTime/1000))
							};

							engine.storage.local.set(data);
						}
					} while (visits.length > 0);
				}
			});
		});
	}
	async getOptions() {
		// get options with default data
		const options = (await engine.storage.sync.get({
			options: {
				tags: '',
				exceptions: 'tag',
				pager: 'withoutfirst',
				tag_mark: 'enabled',
				download: 'enabled',
				download_folder: 'JV',
				post: 'translucent',
				opacity: 0.6,
				depth: 3
			}
		})).options;

		// string to array
		options.tags = options.tags.split(',').map(function(tag) {
			// protect from edvard ruki penisy
			return tag.trim().toLowerCase();
		});

		return options;
	}
	async getStatus() {
		return (await engine.storage.sync.get({enabled: true})).enabled;
	}
	async setStatus(status) {
		await engine.storage.sync.set({enabled: status});

		if (status) {
			engine.action.setIcon({path: '../images/enabled.png'});
		} else {
			engine.action.setIcon({path: '../images/disabled.png'});
		}
	}
	async check(ids) {
		const $this = this;

		return new Promise(function(resolve) {

			let offset;
			switch (parseInt($this.options.depth)) {
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
			engine.storage.local.get(ids, function(object) {
				const list = Object.values(object);
				if (list.length > 0) {
					do {
						const item = list.shift();
						if (item.added > offset) {
							result.push(item.id);
						}
					} while (list.length > 0);
				}

				resolve(result);
			});
		});
	}
	async unlock(postIds) {
		return new Promise(function(resolve) {

			engine.storage.local.get(postIds, function(exists) {
				const params = [];

				let data = {};

				for (const post_id of postIds) {
					data[post_id] = {};

					if (post_id in exists) {
						data[post_id] = exists[post_id];

						if ('text' in exists[post_id])
							continue;
					}

					params.push(`post${post_id}:node(id:"${btoa(`Post:${post_id}`)}") { ... on Post { text attributes { id type ...Attribute_attribute } tags { seoName } } }`);
				}

				if (params.length > 0) {
					fetch('https://api.joyreactor.cc/graphql?JV=1', {
						method: 'POST',
						body: JSON.stringify({query: `
							{${params.join(' ')}}
							fragment AttributePicture_attribute on AttributePicture { 
								__typename
							} 
							fragment AttributeEmbed_attribute on AttributeEmbed { 
								__typename
								value
							}
							fragment Attribute_attribute on Attribute { 
								...AttributePicture_attribute
								...AttributeEmbed_attribute 
							}`})
					}).then(response => response.json()).then(function(response) {

						for (const [key, post] of Object.entries(response.data)) {
							const post_id = key.match(/[0-9]+/)[0];

							Object.assign(data[post_id], post);
						}

						engine.storage.local.set(data);

						resolve(data);
					});
				} else {
					resolve(data);
				}
			});
		});
	}
	async getTag(name, type, page) {
		const $this = this;
		
		return new Promise(function(resolve) {
			let pageStr;
			if (page === 0) {
				pageStr = `offset: 0`;
			} else {
				pageStr = `page:${page}`;
			}

			const params =  `{
						tag(name: "${name}") {
						... on Tag {
							id
							count
							name
							seoName
							synonyms
							rating
							subscribers
							mainTag { 
								id
								count
								name
								seoName
								synonyms
								rating
								subscribers
								image { id }
							}
							image { id }
							hierarchy { seoName name }
							articlePost { text attributes { id type ...Attribute_attribute } }
							postPager(type:${type.toUpperCase()}, favoriteType:null) {
								count
								posts(${pageStr}) { 
									... on Post { 
										id
										rating
										text
										createdAt
										commentsCount
										user { id username }
										tags { seoName name hierarchy { id } }
										attributes { 
											id
											type
											...Attribute_attribute
										}
									}
								}
							}
						}
					}
				}
				fragment AttributePicture_attribute on AttributePicture { 
					__typename
				} 
				fragment AttributeEmbed_attribute on AttributeEmbed { 
					__typename
					value
				}
				fragment Attribute_attribute on Attribute { 
					...AttributePicture_attribute
					...AttributeEmbed_attribute 
				}`;
			
			fetch('https://api.joyreactor.cc/graphql?JV=1', {
				method: 'POST',
				body: JSON.stringify({query: params})
			}).then(response => response.json()).then(async function(response) {
				if (response.data.tag.id !== response.data.tag.mainTag.id) {
					response.data.tag.id = response.data.tag.mainTag.id;
					response.data.tag.count = response.data.tag.mainTag.count;
					response.data.tag.name = response.data.tag.mainTag.name;
					response.data.tag.seoName = response.data.tag.mainTag.seoName;
					response.data.tag.synonyms = response.data.tag.mainTag.synonyms;
					response.data.tag.rating = response.data.tag.mainTag.rating;
					response.data.tag.subscribers = response.data.tag.mainTag.subscribers;
				}

				if (!response.data.tag.postPager.posts.length && type !== 'all') {
					response = await $this.getTag(name, 'all', page);
				} else {
					response = response.data.tag;
				}

				if (response.image === null)
					response.image = 0;

				let data = {};

				for (const post of response.postPager.posts) {
					const post_id = atob(post.id).match(/([0-9]+)/)[1];
					data[post_id] = {text: post.text, attributes: post.attributes, tags: post.tags};
				}

				engine.storage.local.get(Object.keys(data), function(exists) {
					for (let key in exists) {
						Object.assign(data[key], exists[key]);
					}
					
					engine.storage.local.set(data);
				});

				resolve(response);
			});
		});
	}
}
const j = new JV();
j.init();