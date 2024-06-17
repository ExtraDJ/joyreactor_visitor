const engine = (function() {
	if (typeof browser !== 'undefined') {
		browser.action = browser.browserAction;
		return browser;
	}
	return chrome;
})();

String.prototype.val = function() {
	return parseInt(atob(this).match(/([0-9]+)/)[1]);
};
String.prototype.date = function() {
	const date = new Date(this);
	return {
		date: date.toLocaleString('en-GB', {day:'2-digit', month:'short', year:'numeric'}).replaceAll(' ', '.').replaceAll(',.', ' '),
		time: date.getHours()+':'+('0'+date.getMinutes()).slice(-2),
		timestamp: Math.floor(date.getTime() / 1000)
	};
};
function is_num(number) {
	if (number === null || number === undefined)
		return false;

	number = parseInt(number);
	return (typeof number == 'number' && !isNaN(number));
}

var $this;

class JV {
	constructor() {
		$this = this;

		this.api = 'https://api.joyreactor.cc/graphql?JV=1';
		this.tabs = [];
		this.timestamp = Math.floor(Date.now() / 1000);

		this.vars = {
			comeback: {
				jumps: {},
				forwards: {}
			},
			token: {
				string: '',
				expires: 0,
				cycle: false,
				wait: false
			},
			options: {},
			user: {}
		};
	}
	async init() {
		setInterval(function() {
			$this.timestamp++;
		}, 1000);

		$this.netRules();
		$this.handler();

		await $this.status.set(await $this.status.get());
	}
	handler() {
		// on connect - check token
		engine.runtime.onConnect.addListener(async function(request) {
			// if has token - response options
			if (await $this.token.check()) {

				await $this.response(request.sender.tab.id, {
					method: 'options', 
					status: await $this.status.get(),
					options: await $this.options.get(),
					user: await $this.user.get()
				});
			} else {
				// else push to tabs list
				$this.tabs.push(request.sender.tab.id);
			}
			
			return true;
		});
		engine.runtime.onMessage.addListener(async function(request, sender) {
			// if service worker was unloaded
			if (!Object.keys($this.vars.options).length) {
				await $this.options.get();
				await $this.user.get()
			}
			
			switch (request.method) {
				case 'token':
					switch(request.action) {
						case 'set': // recived user token
							if (await $this.token.set(request.data)) {
								// if have tabs waiting - send options
								while ($this.tabs.length) {
									const tab_id = $this.tabs.shift();

									await $this.response(tab_id, {
										method: 'options', 
										status: await $this.status.get(),
										options: await $this.options.get(),
										user: await $this.user.get()
									});
								}
							}
							break;
						case 'del': // need to del token -> renew
							$this.token.del();
							break;
					}
					break;
				case 'options': // send extension options
					switch(request.action) {
						case 'page':
							engine.runtime.openOptionsPage();
							break;
						default:
							await $this.response(sender.tab.id, {
								method: request.method, 
								action: request.action, 
								options: await $this.options.get(),
								user: await $this.user.get()
							});
							break;
					}				
					break;
				case 'user':
					switch(request.action) {
						case 'del': // del user data. login/logout
							$this.user.del();
							break;
					}
					break;
				case 'tag': // tag page
					switch (request.action) {
						case 'get': // check tag page in forwards
							await $this.response(sender.tab.id, await $this.tag.get(sender.tab.id, request.referrer));
							break;
						case 'state': // change tag state
							await $this.response(sender.tab.id, {
								method: 'reload',
								data: await $this.tag.state(request.data)
							});
							break;
					}
					break;
				case 'posts':
					switch (request.action) {
						case 'get': // get posts in visited history
							await $this.response(sender.tab.id, {
								method: request.method, 
								action: 'set', 
								data: await $this.posts.get(request.data)
							});
							break;
						case 'set': // set post as viwed
							await $this.response(sender.tab.id, {
								method: request.method, 
								action: 'viewed',
								data: await $this.posts.set(request.data)
							});
							break;
						case 'unlock': // unlock post
							await $this.response(sender.tab.id, {
								method: request.method, 
								action: request.action,
								data: await $this.posts.unlock(request.data)
							});
							break;
						case 'cache':
							$this.posts.cache();
							break;
					}
					break;
				case 'comments':
					switch (request.action) {
						case 'get': // get comments list
							await $this.response(sender.tab.id, {
								method: request.method, 
								action: 'set', 
								data: await $this.comments.get(request.data)
							});
							break;
					}
					break;
				case 'download': // quick download
					$this.download(request.data);
					break;
			}

			return true;
		});
		
		engine.storage.sync.onChanged.addListener(function() {
			$this.vars.options = {};
			$this.options.get();
		});
		engine.runtime.onInstalled.addListener(async function() {
			await $this.status.set(await $this.status.get());

			// on install/update extension - clear cache
			$this.posts.cache();

			// import posts from browser history to extension history
			// get all history. check by url, because multidomain, but single engine and database
			engine.history.search({'text': '/post/', 'maxResults': 1000000, 'startTime': 0}, function(visits) {
				let data = {};

				if (visits.length > 0) {
					// while have
					while (visits.length) {
						const item = visits.shift();

						const match = item.url.match(/(http|https):\/\/[a-zA-Z0-9-.]*(reactor|jr-proxy|jrproxy)[a-z.]+\/post\/([0-9]+)[/]{0,1}/);

						// if this rly post page
						if (match) {
							data[match[3]] = {
								post_id: match[3],
								added: Math.floor(item.lastVisitTime / 1000)
							};
						}
					}
					// save to extension history
					$this.posts.save(data);
				}
			});

			// Это существует только для того, что бы сконвертировать уже имеющуюся историю просмотренных постов, по причине замены id на post_id
			// Спустя какое то время это будет удалено
			//////////////////////////////////// RM ////////////////////////////////////
			engine.storage.local.get(null, function(data) {
				let update = {};
				for (const post_id in data) {
					if (!is_num(post_id))
						continue;

					if ('id' in data[post_id]) {
						update[post_id] = {
							post_id: data[post_id].id,
							added: data[post_id].added
						}
					}
				}
				$this.posts.save(update);
			});
			//////////////////////////////////// RM ////////////////////////////////////
		});
		// click on extension icon
		engine.action.onClicked.addListener(async function() {
			// toggle status
			if (await $this.status.get()) {
				await $this.status.set(false);
			} else {
				await $this.status.set(true);
			}

			// send reload to active page
			engine.tabs.query({
				active: true,
				url: engine.runtime.getManifest()['content_scripts'][0]['matches']
			}, async function(tabs) {
				for (const tab of tabs) {
					await $this.response(tab.id, {method: 'reload'});
				}
			});
		});
	}
	async response(tab_id, data) {
		return new Promise(function(resolve) {
			engine.tabs.sendMessage(tab_id, data).then(function() {
				resolve(true);
			}).catch(function() {
				resolve(false);
			});
		})
	}
	get token() {
		return {
			query: function() {
				// get any active tab
				engine.tabs.query({
					url: engine.runtime.getManifest()['content_scripts'][0]['matches']
				}, async function(tabs) {
					tabs = tabs.sort(function(a, b) {
						return b.id > a.id ? 1 : b.id < a.id ? -1 : 0;
					});
					for (const tab of tabs) {
						// tab must be alive
						if (tab.status == 'unloaded')
							continue;

						// if sended - stop
						if (await $this.response(tab.id, {method: 'token'}))
							break;
					}
				});
			},
			wait: function() {
				if (!$this.vars.token.wait) {
					$this.vars.token.wait = setInterval(function() {
						$this.token.query();
					}, 2 * 1000);
				}
			},
			check: function() {
				return new Promise(function(resolve) {
					// diff of expire time and realtime
					const time = $this.vars.token.expires - $this.timestamp;
					if (time <= 0) {
						$this.token.wait();
						resolve(false);
					} else {
						resolve(true);
					}
				});
			},
			set: function(data) {
				return new Promise(function(resolve) {
					if ($this.vars.token.wait) {
						clearInterval($this.vars.token.wait);
						$this.vars.token.wait = false;
					}
					// no user
					if (data === null) {
						$this.vars.token.expires = $this.timestamp + $this.timestamp;
					} else {
						$this.vars.token.string = data;
						$this.vars.token.expires = JSON.parse(atob(data.split('.')[1])).exp;

						const time = $this.vars.token.expires - $this.timestamp;
						if (!$this.vars.token.cycle) {
							$this.vars.token.cycle = setTimeout(function() {
								$this.vars.token.cycle = false;
								$this.token.query();
							}, (time - 5) * 1000);
						}
					}

					if (engine.runtime.getManifest().manifest_version == 3) {
						// net rules. auto authorization with token
						engine.declarativeNetRequest.updateDynamicRules({addRules: [{
							id: 1,
							priority: 1,
							action: {
								type: 'modifyHeaders',
								requestHeaders: [
									{ header: 'Origin', operation: 'set', value: new URL($this.api).origin },
									{ header: 'Content-Type', operation: 'set', value: 'application/json' },
									{ header: 'Authorization', operation: 'set', value: `Bearer ${$this.vars.token.string}` }
								],
								responseHeaders: [
									{ header: 'Access-Control-Allow-Headers', operation: 'set', value: 'Content-Type' },
									{ header: 'Access-Control-Allow-Origin', operation: 'set', value: '*' }
								]
							},
							condition: {
								urlFilter: $this.api
							}
						}], removeRuleIds: [1]}, function() {});
					}
					
					resolve(true);
				});
			},
			del: function() {
				$this.vars.token.expires = 0;
				$this.vars.token.string = '';
				$this.vars.token.cycle = false;
			}
		};
	}
	get options() {
		return {
			get: function() {
				return new Promise(function(resolve) {
					const default_options = {
						extension_ignore_url: ['post', 'user', 'discussion', 'people'],
						extension_depth: 3,

						tags_list: [],
						tags_exceptions_page: 'tag',

						download_status: 1,
						download_folder: 'JV/',
						download_prefix: '',

						post_share_disabled: 1,
						post_tags_mark: 1,
						post_pages_action: 'all',
						post_visual_mark: 1,
						post_action: 'translucent',
						post_action_unread: 0,
						post_opacity: 0.6,
						post_pager: 'withoutfirst',
						post_visited_date: 1
					}

					// if no options loaded
					if (!Object.keys($this.vars.options).length) {
						engine.storage.sync.get({options: {}}, async function(data) {
							// check key exists in options -> default value
							for (const [key, value] of Object.entries(default_options)) {
								if (!(key in data.options))
									data.options[key] = value;
							}
							
							$this.vars.options = data.options;
							
							if (Array.isArray($this.vars.options.tags_list)) {
								$this.vars.options.tags_list = await $this.tag.ids($this.vars.options.tags_list);
								engine.storage.sync.set({options: $this.vars.options});
							}

							resolve($this.vars.options);
						});
					} else {
						resolve($this.vars.options);
					}
				});
			}
		}
	}
	get status() {
		return {
			get: async function() {
				return (await engine.storage.sync.get({enabled: true})).enabled;
			},
			set: async function(status) {
				let path = 'data';
				if (engine.runtime.getManifest().manifest_version == 3)
					path = '..';

				await engine.storage.sync.set({enabled: status}, function() {
					if (status) {
						engine.action.setIcon({path: `${path}/images/enabled.png`});
					} else {
						engine.action.setIcon({path: `${path}/images/disabled.png`});
					}

					return true;
				});
			}
		}
	}
	get user() {
		return {
			query: function() {
				return new Promise(function(resolve) {
					fetch($this.api, {
						method: 'POST',
						body: JSON.stringify({query: `{ me { user { id } blockedTags { mainTag { id } } subscribedTags { mainTag { id } } } }`})
					}).then(function(response) {
						return response.json();
					}).then(function(response) {
						$this.vars.user = {
							user_id: null,
							tags: {
								blocked: [],
								subscribed: []
							},
							time: $this.timestamp
						}
						if (response.data.me !== null) {
							// user_id
							$this.vars.user.user_id = response.data.me.user.id.val();
							// user tags

							for (const item of response.data.me.blockedTags) {
								$this.vars.user.tags.blocked.push(item.mainTag.id.val());
							}
							for (const item of response.data.me.subscribedTags) {
								$this.vars.user.tags.subscribed.push(item.mainTag.id.val());
							}
						}

						engine.storage.local.set({user: $this.vars.user});

						resolve($this.vars.user);
					});
				});
			},
			get: function() {
				return new Promise(async function(resolve) {
					// if have data in variable
					if (Object.keys($this.vars.user).length) {
						if (($this.timestamp - $this.vars.user.time) < 3600) {
							resolve($this.vars.user);
							return true;
						}
					} else {
						engine.storage.local.get('user', async function(cached) {
							// if found in cache
							if ('user' in cached) {
								// cached 1h
								if (($this.timestamp - cached.user.time) < 3600) {
									$this.vars.user = cached.user;
									resolve($this.vars.user);
									return true;
								}
							}
						});
					}

					resolve(await $this.user.query());
					return true;
				});
			},
			del: async function() {
				await $this.user.query();
			}
		}
	}
	get tag() {
		return {
			get: async function(tab_id, referer) {
				return new Promise(async function(resolve) {
					let params;
					let tag_url;

					// we have forwards?
					if (tab_id in $this.vars.comeback.forwards) {
						tag_url = decodeURI($this.vars.comeback.forwards[tab_id]);
						delete $this.vars.comeback.forwards[tab_id];
					} else {
						// try referer
						tag_url = decodeURI(referer);
					}

					if (!tag_url.match('/tag/')) {
						resolve(false);
						return false;
					}

					params = new URL(tag_url).pathname.split('/');

					const tag_name = decodeURI(params[2]).replace('+', ' ');
					if (tag_name === undefined) {
						resolve(false);
						return false;
					}
					
					let tag_type = 'good';
					let tag_page_num = 0;

					// /tag/tagname/best/123
					if (params.length > 4) {
						tag_page_num = parseInt(params.at(-1));
						tag_type = params.at(-2);
					}

					// /tag/tagname/123 || /tag/tagname/all
					if (params.length == 4) {
						const last = params.at(-1);
						if (isNaN(parseInt(last))) {
							tag_type = last;
						} else {
							tag_page_num = parseInt(last);
						}
					}

					let url_path = `/tag/${tag_name.replace(' ', '+')}`;
					if (tag_type !== 'good')
						url_path += `/${tag_type}`;

					resolve({
						method: 'tag', 
						action: 'set',
						data: await $this.tag.tagQuery(tag_name, tag_type, tag_page_num),
						tag_type: tag_type,
						tag_page_num: tag_page_num,
						tag_url: tag_url,
						url_path: url_path
					});
				});
			},
			tagQuery: function(tag_name, tag_type, tag_page_num) {
				return new Promise(function(resolve) {
					let pagerParam;
					if (tag_page_num === 0) {
						pagerParam = `offset: 0`;
					} else {
						pagerParam = `page:${tag_page_num}`;
					}

					const params =  `
						{
							tag(name: "${tag_name}") {
								... on Tag {
									id
									count
									name
									synonyms
									rating
									subscribers
									image { id }
									mainTag { 
										id
										count
										name
										synonyms
										rating
										subscribers
										image { id }
									}
									hierarchy { name }
									articlePost { text attributes { id type image { type hasVideo } ...Attribute_attribute } }
									postPager(type:${tag_type.toUpperCase()}, favoriteType:null) {
										count
										posts(${pagerParam}) { 
											... on Post { 
												id
												text
												createdAt
												commentsCount
												user { id username }
												tags { name hierarchy { id } }
												attributes { id type image { type hasVideo } ...Attribute_attribute }
											}
										}
									}
								}
							}
						}
						fragment AttributePicture_attribute on AttributePicture { __typename } 
						fragment AttributeEmbed_attribute on AttributeEmbed { __typename value }
						fragment Attribute_attribute on Attribute { ...AttributePicture_attribute ...AttributeEmbed_attribute }`;
					
					fetch($this.api, {
						method: 'POST',
						body: JSON.stringify({query: params})
					}).then(function(response) {
						return response.json();
					}).then(async function(response) {

						// if this is synonym of tag - set main tag data
						if (response.data.tag.id !== response.data.tag.mainTag.id) {
							for (const [key, value] of Object.entries(response.data.tag.mainTag)) {
								response.data.tag[key] = value;
							}
						}

						if (response.image === null)
							response.image = 0;

						// if no data -> try 'all'
						if (!response.data.tag.postPager.posts.length && tag_type !== 'all') {
							response = await $this.tag.tagQuery(tag_name, 'all', tag_page_num);
						} else {
							response = response.data.tag;

							response.tag_id = response.id.val();

							// data to cache censored posts
							let tocache = {};
							let remove_blocked = [];
							for (const [key, post] of Object.entries(response.postPager.posts)) {
								post.post_id = post.id.val();
								post.user.id = post.user.id.val();

								// tags
								post.tagsList = [];
								for (const tag of post.tags) {
									const tagIds = [];
									for (var i of tag.hierarchy) {
										tagIds.push(i.id.val());
									}

									if ($this.vars.user.tags.blocked.includes(tagIds[0]))
										remove_blocked.push(post.post_id);

									post.tagsList.push({
										name: tag.name,
										ids: tagIds.join(','),
										link: tag.name.replaceAll(' ', '+')
									});
								}

								// added date/time/timestamp
								Object.assign(post, post.createdAt.date());

								for (const attribute of post.attributes) {
									attribute.id = attribute.id.val();
								}

								// if post was added more than an hour ago -> to cache
								if (($this.timestamp - post.timestamp) > 3600)
									tocache[post.post_id] = post;
							}

							response.postPager.posts = response.postPager.posts.filter(function(item) {
								return !remove_blocked.includes(item.post_id);
							});

							// if exists data to cache
							if (Object.keys(tocache).length > 0) {
								$this.posts.save(tocache);
							}
						}

						resolve(response);
					});
				});
			},
			state: function(data) {
				return new Promise(function(resolve) {
					fetch($this.api, {
						method: 'POST',
						body: JSON.stringify({
							query: `mutation FavoriteBlogMutation($id: ID! $requestedState: FavoriteTagState!) {
								favoriteTag(id: $id, requestedState: $requestedState) { __typename }
							}`,
							variables: {id: btoa(`Tag:${data.tag_id}`), requestedState: data.state}
						})
					}).then(function() {
						$this.user.del();
						resolve(true);
					});
				});
			},
			ids: function(tags) {
				return new Promise(function(resolve) {
					if (!tags.length) {
						resolve({});
						return false;
					}

					const list = [];
					for (const i in tags) {
						list.push(`tag${i}:tag(name:"${tags[i]}") { mainTag { id } }`);
					}
					
					let result = {};
					fetch($this.api, {
						method: 'POST',
						body: JSON.stringify({query: `{${list.join(' ')}}`})
					}).then(function(response) {
						return response.json();
					}).then(function(response) {
						for (const [i, tag] of Object.entries(response.data)) {
							if (tag === null)
								continue;
							
							result[tags[i.match(/([0-9]+)/)[1]]] = tag.mainTag.id.val();
						}
						resolve(result);
					});
				});
			}
		}
	}
	get posts() {
		return {
			save: function(save) {
				engine.storage.local.get(Object.keys(save), function(exists) {
					for (var i of Object.keys(save)) {
						if (!(i in exists))
							exists[i] = {};
					}
					
					let data = [exists, save].reduce(function(target, item) {
						for (let k in item) {
							Object.assign(target[k], item[k]);
						}
						return target;
					});

					for (const post_id in data) {
						for (const [key, value] of Object.entries(data[post_id])) {
							if (['post_id', 'added'].includes(key))
								data[post_id][key] = parseInt(value);

							if (!['post_id', 'added', 'text', 'attributes', 'tags'].includes(key))
								delete data[post_id][key];
						}
					}
					engine.storage.local.set(data);
				});

				return  true;
			},
			get: function(post_ids) {
				return new Promise(function(resolve) {
					let offset;
					switch ($this.vars.options.extension_depth) {
						case 0: // 24 h
							offset = $this.timestamp - (60*60*24);
							break;
						case 1: // 1 week
							offset = $this.timestamp - (60*60*24*7);
							break;
						case 2: // 2 week
							offset = $this.timestamp - (60*60*24*14);
							break;
						case 3: // 1 month
							offset = $this.timestamp - (60*60*24*30);
							break;
						case 4: // 6 months
							offset = $this.timestamp - (60*60*24*180);
							break;
						case 5: // without limits
							offset = 0;
							break;
					}

					let result = {};

					// get all data from storage
					engine.storage.local.get(post_ids, function(object) {
						const list = Object.values(object);

						while (list.length) {
							const item = list.shift();
							// skip if only cache
							if (item.added === undefined)
								continue;

							if (item.added > offset) {
								result[item.post_id] = new Date(item.added * 1000).toLocaleString('uk-UA').replaceAll(',', '');
							}
						}

						resolve(result);
						return true;
					});
				});
			},
			set: function(post_id) {
				return new Promise(function(resolve) {
					engine.storage.local.get([post_id], function(visited) {
						// skip if exists
						if (post_id in visited) {
							if ('added' in visited[post_id]) {
								resolve({post_id: post_id, result: false});
								return false;
							}
						}

						let save = {};
						save[post_id] = {
							post_id: post_id,
							added: $this.timestamp
						};

						$this.posts.save(save);

						resolve({post_id: post_id, result: true});
						return true;
					});
				});
			},
			unlock: function(post_ids) {
				if (!post_ids.length)
					return false;

				return new Promise(function(resolve) {
					engine.storage.local.get(post_ids, async function(cached) {
						// rating / vote / comments info
						const info = [];
						// posts to unlock
						const unlock = {};

						// result data
						let data = {};

						for (const post_id of post_ids) {
							data[post_id] = {};

							// push to info
							info.push(`post${post_id}:node(id:"${btoa(`Post:${post_id}`)}") { 
											... on Post {
												id
												createdAt
												rating
												commentsCount
												viewedCommentsCount
												vote { power }
												user { id }
											} 
										}`);

							unlock[post_id] = `post${post_id}:node(id:"${btoa(`Post:${post_id}`)}") { 
								... on Post {
									id
									text
									tags { name }
									attributes { id type image { type hasVideo } ...Attribute_attribute }
								} 
							}`;

							// check in cache
							if (post_id in cached) {
								data[post_id] = cached[post_id];

								// check text/attributes in cache. exists - skip unlock
								if ('text' in cached[post_id]) {
									delete unlock[post_id];
								}
							}
						}

						// get info
						await fetch($this.api, {
							method: 'POST',
							body: JSON.stringify({query: `{${info.join(' ')}}`})
						}).then(function(response) {
							return response.json();
						}).then(function(response) {
							// object to array
							response = Object.values(response.data);

							for (const post of response) {
								post.post_id = post.id.val();
								post.user.id = post.user.id.val();

								// added date/time/timestamp
								Object.assign(post, post.createdAt.date());

								// if post older 6 month, or this is myself post - disable votes and show rating
								if (($this.timestamp - post.timestamp) > 60*60*24*180 || $this.vars.user.user_id == post.user.id) {
									post.rating = post.rating.toFixed(1);
									post.vote = 0;
								} else {
									if (post.vote === null) {
										post.rating = '--';
									} else {
										post.rating = post.rating.toFixed(1);
										if (post.vote.power > 0) {
											post.vote = 'plus';
										} else {
											post.vote = 'minus';
										}
									}
								}

								Object.assign(data[post.post_id], post);
							}
						});

						// if need to unlock
						if (Object.values(unlock).length) {
							fetch($this.api, {
								method: 'POST',
								body: JSON.stringify({query: `
									{${Object.values(unlock).join(' ')}}
									fragment AttributePicture_attribute on AttributePicture { __typename } 
									fragment AttributeEmbed_attribute on AttributeEmbed { __typename value }
									fragment Attribute_attribute on Attribute { ...AttributePicture_attribute ...AttributeEmbed_attribute }`})
							}).then(function(response) {
								return response.json();
							}).then(function(response) {
								// object to array
								response = Object.values(response.data);

								// data to cache censored posts
								let tocache = {};

								for (const post of response) {
									post.post_id = post.id.val();
									for (const attribute of post.attributes) {
										attribute.id = attribute.id.val();
									}

									Object.assign(data[post.post_id], post);

									// if post was added more than an hour ago -> to cache
									if (($this.timestamp - data[post.post_id].timestamp) > 3600)
										tocache[post.post_id] = post;
								}

								// if exists data to cache
								if (Object.keys(tocache).length > 0) {
									$this.posts.save(tocache);
								}

								resolve(data);
							});
						} else {
							resolve(data);
						}

						return true;
					});
				});
			},
			cache: function() { // clear cache
				engine.storage.local.get(null, function(data) {
					let update = {};
					for (const post_id in data) {
						// if this not post data
						if (!is_num(post_id))
							continue;

						// if this only cache
						if (!('added' in data[post_id])) {
							update[post_id] = {};
						} else {
							update[post_id] = {
								post_id: data[post_id].post_id,
								added: data[post_id].added
							}
						}
					}
					engine.storage.local.set(update);
				});
			}
		};
	}
	get comments() {
		return {
			get: function(post_id) {
				return new Promise(function(resolve) {
					const params =  `{
							node(id: "${btoa(`Post:${post_id}`)}") { 
								... on Post { 
									viewedCommentsAt
									user { id }
									comments { 
										id
										text
										createdAt
										level
										rating
										parent { __typename id }
										user { id username }
										vote { power }
										attributes { id type image { type hasVideo } ...Attribute_attribute }
									} 
								} 
							}
						}
						fragment AttributePicture_attribute on AttributePicture { __typename } 
						fragment AttributeEmbed_attribute on AttributeEmbed { __typename value }
						fragment Attribute_attribute on Attribute { ...AttributePicture_attribute ...AttributeEmbed_attribute }`;
					
					fetch($this.api, {
						method: 'POST',
						body: JSON.stringify({query: params})
					}).then(function(response) {
						return response.json();
					}).then(function(response) {
						response = response.data.node;
						// comments viwed at
						const viewed = Math.floor(new Date(response.viewedCommentsAt).getTime() / 1000);

						response.post_id = post_id;
						response.user.id = response.user.id.val();

						for (let comment of response.comments) {
							if (comment.parent !== null)
								comment.parent.id = comment.parent.id.val();

							comment.post_id = post_id;
							comment.id = comment.id.val();
							comment.user.id = comment.user.id.val();
							comment.rating = comment.rating.toFixed(1);
							comment.vote = 0;

							for (const attribute of comment.attributes) {
								attribute.id = attribute.id.val();
							}

							// added date/time/timestamp
							Object.assign(comment, comment.createdAt.date());

							// if comment younger 3 days - enable votes
							if (($this.timestamp - comment.timestamp) < 60*60*24*3) {
								if (Math.abs(Math.floor(comment.rating)) < 3 && $this.vars.user.user_id !== comment.user.id)
									comment.rating = '≈0';

								if ($this.vars.user.user_id !== comment.user.id)
									comment.vote = 1;
							}

							if (comment.timestamp > viewed) {
								if ($this.vars.user.user_id == comment.user.id) {
									comment.class = 'new_my new';
								} else {
									comment.class = 'new';
								}
							}
						}

						resolve(response);
					});
				});
			}
		}
	}
	download(data) {
		const filename = `${$this.vars.options.download_folder}${$this.vars.options.download_prefix}${data.filename}`;

		if (engine.runtime.getManifest().manifest_version == 3) {
			engine.downloads.download({
				url: data.file, 
				filename: filename,
				conflictAction: 'overwrite'
			});
		} else {
			engine.downloads.download({
				url: data.url, 
				filename: filename,
				conflictAction: 'overwrite',
				headers: [
					{name: 'Referer', value: 'https://joyreactor.cc/'}
				]
			});
		}
	}
	netRules() {
		if (engine.runtime.getManifest().manifest_version == 3) {
			const rules = [
				{
					id: 1, // allow redirect, if blocked
					priority: 1,
					action: { type: 'allow' },
					condition: { urlFilter: '*/tag/*', resourceTypes: ['main_frame'] }
				},
				{
					id: 2, // back to tag page, if redirect
					priority: 1,
					action: { type: 'redirect', redirect: { transform: { path: '', fragment: '#JV=tag' } } },
					condition: { urlFilter: '/images/censorship/*', resourceTypes: ['main_frame'] }
				},
				{
					id: 3, // images download
					priority: 1,
					action: {
						type: 'modifyHeaders',
						requestHeaders: [{ header: 'Referer', operation: 'set', value: 'https://joyreactor.cc/' }],
						responseHeaders: [{ header: 'Access-Control-Allow-Origin', operation: 'set', value: '*' }]
					},
					condition: { urlFilter: '/pics/post/*', resourceTypes: ['xmlhttprequest'] }
				}
			];

			// if no rules - set it
			engine.declarativeNetRequest.getSessionRules(function(event) {
				if (event.length !== rules.length)
					engine.declarativeNetRequest.updateSessionRules({addRules: rules, removeRuleIds: [1,2,3,4,5]}, function() {});
			});
			// catch requests
			engine.webRequest.onBeforeRequest.addListener(
				function(event) {
					// if try to open tag page
					if (event.url.match(/tag/))
						$this.vars.comeback.jumps[event.requestId] = event.url;

					// if tag page redirected to censorship page
					if (event.url.match(/censorship/)) {
						// find in previous jumps
						if (event.requestId in $this.vars.comeback.jumps) {
							$this.vars.comeback.forwards[event.tabId] = $this.vars.comeback.jumps[event.requestId];
						}
					}
				},
				{ urls: ['<all_urls>'], types: ['main_frame'] }
			);
		} else {
			// modify headers for api requests
			engine.webRequest.onBeforeSendHeaders.addListener(
				function(details) {
					let headers = details.requestHeaders;
					for (var i = 0, l = headers.length; i < l; ++i) {
						if (headers[i].name == 'Origin') {
							headers[i].value = new URL($this.api).origin;
							break;
						}
					}
					headers.push({name: 'Content-Type', value: 'application/json'});
					return {requestHeaders: headers};
				},
				{ urls: [$this.api], types: ['xmlhttprequest'] },
				['requestHeaders', 'blocking']
			);
			// catch requests
			engine.webRequest.onBeforeRequest.addListener(
				function(event) {
					// if try to open tag page
					if (event.url.match(/tag/))
						$this.vars.comeback.jumps[event.requestId] = event.url;

					// if tag page redirected to censorship page
					if (event.url.match(/censorship/)) {
						// find in previous jumps
						if (event.requestId in $this.vars.comeback.jumps) {
							$this.vars.comeback.forwards[event.tabId] = $this.vars.comeback.jumps[event.requestId];
						}
						// back to tag page
						return { redirectUrl: `${new URL(event.url).origin}#JV=tag` };
					}
				},
				{ urls: ['<all_urls>'], types: ['main_frame'] },
				['blocking']
			);
		}
	}
}
const j = new JV();
j.init();