const engine = (function() {
	if (typeof browser !== 'undefined') {
		return browser;
	}
	return chrome;
})();

var $this;

$.fn.Container = function(data, html) {
	if (html === undefined) {
		html = true;
	}
	var response = '';

	$(this).each(function() {
		var object = $(this);
		var nodehtml = '';
		var template = object.attr('ctemplate');

		if (template === undefined) {
			template = object.html();
			object.attr('ctemplate', template);
		}

		for (const key in data) {
			nodehtml += makeNode(template, key, data);
		}

		if (html === true) {
			response = nodehtml;
		} else {
			object.html(nodehtml);
		}
	});
	if (response.length) {
		return response;
	}
	return $(this);
}
function makeNode(template, key, collection) {
	const regex = /{{\s*([~\w\.\[\]\-]+)\s*}}/gm;
	template = template.replace(regex, function(str, varname) {	
		const varpath = varname.split('.');
		let fixed = getData(varpath, key, collection);
		if (undefined === fixed) {
			fixed = '';
		}
		return fixed;
	});
	return template;
}

function getData(path, key, collection, level) {
	if (undefined === path) {
		return undefined;
	}
	if (undefined === level) {
		level = 0;
	}
	if (path.length === level) {
		return collection;
	}

	if (0 === level) {
		switch(path[0]) {
			case '~key~':
				collection = key;
				break;
			case '~item~':
			case '~array~':
			case '~check~':
				if (undefined === collection) 
					return undefined;
				collection = collection[key];
				break;
			case '~collection~':
				break;
			default:
				collection = window[path[0]];
		}
	} else {
		if (undefined === collection) {
			return undefined;
		}
		switch (path[0]) {
			case '~key~':
				collection = collection[key];
				break;
			case '~check~':
				if (collection !== null) {
					if (typeof collection[path[level]] === 'boolean') {
						collection[path[level]] = collection[path[level]].toString();
					}
					
					var checkLevel = level;
					if (collection[path[level]] == path[++checkLevel]) {
						return path[++checkLevel];
					} else {
						collection = collection[path[level]];
					}
				}
				break;
			case '~array~':
				if (path.length-2 === level) {
					if (typeof collection[path[level]] == 'object') {
						if (Object.keys(collection[path[level]]).length) {
							var tp_level = level;
							collection = $('#'+path[++tp_level]).Container(collection[path[level]]);
							return collection;
						}
					} else {
						collection = undefined;
					}
				} else {
					collection = collection[path[level]];
				}
				break;
			default:
				collection = collection[path[level]];
		}
	}
	
	return getData(path, key, collection, ++level);
}

class JV {
	constructor() {
		$this = this;

		this.url = window.location.pathname.split('/');

		this.vars = {
			status: true,
			options: {},
			user: {},
			init: false
		};
		this.lists = {
			posts: {},
			unlock: [],
			viewed: {}
		};
	}
	async init() {
		// load templates. on load - we a ready
		$this.templates(function() {
			// messages handler
			$this.handler();

			// do not run if image
			// or user child pages
			if (!['pics', 'images'].includes($this.url[1]) && !['comments', 'friends', 'infriends', 'blocks'].includes($this.url[3])) {
				engine.runtime.connect();
			}
		});
	}
	handler() {
		engine.runtime.onMessage.addListener(async function(request) {
			switch (request.method) {
				case 'token':
					engine.runtime.sendMessage({method: 'token', action: 'set', data: await $this.token()});
					break;
				case 'options': // received options
					if ($this.vars.init)
						return false;

					$this.vars = request;

					// we are ready to user actions
					$this.userHandler();

					// if this is redirected
					if (window.location.href.includes('JV=tag')) {
						// try tag
						engine.runtime.sendMessage({method: 'tag', action: 'get', referrer: document.referrer});
					} else {
						// this is normal page
						$this.posts.get();
					}

					$this.vars.init = true;
					break;
				case 'tag':
					switch (request.action) {
						case 'set': // unlock tag page 
							$this.tag.set(request, function() {
								$this.posts.get();
							});
							break;
					}
					break;
				case 'posts':
					switch (request.action) {
						case 'set': // set visited
							$this.posts.set(request.data, function() {
								if ($this.vars.options.post_action_unread || $this.lists.unlock.length) {
									engine.runtime.sendMessage({method: 'posts', action: 'unlock', data: $this.lists.unlock});
								} else {
									$this.posts.pager();
								}
							});
							break;
						case 'unlock': // unlock censored
							$this.posts.unlock(request.data);
							break;
						case 'viewed': // post successfully marked as visited
							$this.posts.viewed(request.data);
							break;
					}
					break;
				case 'comments':
					switch (request.action) {
						case 'set':
							$this.comments.set(request.data);
							break;
					}
					break;
				case 'reload': // if optins changed - reload page
					window.location.reload();
					break;
			}
			return true;
		});
	}
	userHandler() {
		$('#submenu').append('<span data-action="options" class="big_button" title="Настройки"></span>');
		// login, logout - reset token
		$(document).on('click', '#logout, input[value="Войти"]', function() {
			engine.runtime.sendMessage({method: 'token', action: 'del'});
		});

		// tag subscribe/unsubscribe/block - clear user data
		$(document).on('click', '.change_favorite_link', function() {
			engine.runtime.sendMessage({action: 'user', data: 'del'});
		});

		// tag subscribe/unsubscribe/block. only for censored tags
		$(document).on('click', '[data-tag_id]', function() {
			$this.tag.state($(this).attr('data-tag_id'), $(this).parent().attr('class'));
		});

		// scroll visitor handler
		if ($this.url[1] !== 'post') {
			$(window).on('scroll', function() {
				if ($(window).scrollTop() < 100)
					return false;
				// check all posts
				for (const [post_id, item] of Object.entries($this.lists.posts)) {
					// if the block is fully visible on screen				
					if ((item.offset().top + item.height()) < ($(window).height() + $(window).scrollTop()) && !(post_id in $this.lists.viewed)) {
						// да, это ебучий костыль, что бы оно не срало 10 запросов за один скролл
						// потому закидываем во временный список, и ждем ответа от фонового скрипта, который уже точно подвердит что пост сохранен
						// если нет ответа в указанное время - снова делаем его живим. на это даеться всего 100ms
						// варианта лучше я не придумал
						// (凸ಠ益ಠ)凸
						$this.lists.viewed[post_id] = post_id;
						setTimeout(function() {
							delete $this.lists.viewed[post_id];
						}, 100);

						// mark post as visited
						engine.runtime.sendMessage({method: 'posts', action: 'set', data: post_id});
					}
				}
			});
		}
		// mark post as visited when click link/vote
		// if this is download button - load all post content
		$(document).on('click', '.postContainer a, .postContainer .vote-plus, .postContainer .vote-minus, .postContainer [data-action]', function() {
			const post_id = $(this).parents('.postContainer').attr('id').match(/([0-9]+)$/)[1];
			if ($(this).attr('data-action') == 'download') {
				$this.download($(this));
			}
			if (post_id in $this.lists.posts) {
				engine.runtime.sendMessage({method: 'posts', action: 'set', data: post_id});
				delete $this.lists.posts[post_id];
			}
		});
		$(document).on('click', '#submenu > [data-action]', function() {
			switch($(this).attr('data-action')) {
				case 'download':
					$('.postContainer [data-action="download"]').each(function() {
						$(this).click();
					});
					break;
				case 'options':
					engine.runtime.sendMessage({method: 'options', action: 'page'});
					break;
			}

		});
		// return to default when clicking on a post
		$(document).on('click', '.postContainer', function() {
			if ($(this).hasClass('JV_title')) {
				$(this).removeClass('JV_title');
				$(this).css('opacity', 1);
			}
		});
		// get comments list
		$(document).on('click', '.JV_toggleComments', async function(event) {
			event.preventDefault();

			const post_id = $(this).parents('.postContainer').attr('id').match(/([0-9]+)$/)[1];

			if ($(this).hasClass('comOpened')) {
				$(this).removeClass('comOpened');
				$(`#postContainer${post_id} .post_comment_list`).css('display', 'none');
				return false;
			} else {
				$(this).addClass('comOpened');
				engine.runtime.sendMessage({method: 'comments', action: 'get', data: post_id});
				return true;
			}			
		});
		// send comment
		$(document).on('click', '.JV_submit', function() {
			$this.comments.add(new FormData($(this).parent('form')[0]))
		});
		// shortcut download
		$(document).on('keydown', function(event) {
			// Ctrl + Shift + S
			if (event.keyCode == 83 && event.ctrlKey && event.shiftKey) {
				let target;
				if ($this.url[1] == 'post') {
					target = $('[data-action="download"]');
				} else {
					let minDistance = 50000;

					// get button closest to center
					$.each($('[data-action="download"]'), function() {
						let distance = Math.abs(($(this).offset().top + $(this).height()) - (($(window).height() / 2) + $(window).scrollTop()));
						if (minDistance > distance && $(window).scrollTop() < $(this).offset().top) {
							minDistance = distance;
							target = $(this);
						}
					});
				}

				target.click();
			}
		});
	}
	templates(callback) {
		fetch(engine.runtime.getURL('data/templates.html'), {}).then(function(response) {
			return response.text();
		}).then(function(response) {
			document.getElementsByTagName('body')[0].append(new DOMParser().parseFromString(response, 'text/html').getElementsByTagName('templates')[0]);
			callback();
		});
	}
	async token() {
		return new Promise(function(resolve) {
			fetch('https://api.joyreactor.cc/graphql', {
				method: 'POST',
				credentials: 'include',
				headers: {'Content-Type': 'application/json'},
				body: JSON.stringify({query: '{ me { token } }'})
			}).then(function(response) {
				return response.json()
			}).then(function(response) {
				if (response.data.me === null) {
					resolve(null);
				} else {
					resolve(response.data.me.token);
				}
			}).catch(function() {
				return false;
			});
		});
	}
	get tag() {
		return {
			set: function(request, callback) {
				// if redirect to subdomain
				if (new URL(request.tag_url).hostname !== window.location.hostname) {
					window.location = request.tag_url;
					return;
				}

				// set page url
				window.history.replaceState('tagPage', '', request.tag_url);
				$this.url = request.tag_url.split('/');

				// set page title
				document.title = `${request.data.name} | JoyReactor`;

				// menu links
				const link = request.data.name.replaceAll(' ', '+');
				const links = $('#submenu [href]');
				$.each(links, function() {
					if ($(this).attr('href') == 'http://m.joyreactor.cc/top') {
						$(this).parent('div').remove();
						return;
					}

					$(this).parent('div').removeClass('active');

					$(this).text($(this).text().replace(/ \([0-9+]+\)/, ''));

					// re build links and mark as active
					const last = $(this).attr('href').split('/').pop();
					if (['new', 'best', 'all'].includes(last)) {
						if (request.tag_type == last)
							$(this).parent('div').addClass('active');

						$(this).attr('href', `/tag/${link}/${last}`);
					} else {
						if (request.tag_type == 'good')
							$(this).parent('div').addClass('active');

						$(this).attr('href', `/tag/${link}`);
					}
				});

				// remove trends
				$('.trends_wr').remove();

				// data for template
				let data = request.data;

				// breadcrumbs
				data.breadcrumbs = [{url: 'https://joyreactor.cc/', name: 'Главная'}];
				data.breadcrumbsCurrent = '';

				while (request.data.hierarchy.length) {
					const tag = request.data.hierarchy.pop();
					const link = tag.name.replaceAll(' ', '+');

					if (!request.data.hierarchy.length) {
						data.breadcrumbsCurrent = tag.name;
					} else {
						data.breadcrumbs.push({url: `/tag/${link}`, name: tag.name})
					}
				}

				// tag state
				request.data.favorite = {class: 'add_to_fav', text: 'подписаться'};
				request.data.block = {class: 'add_to_unpopular', text: 'заблокировать'};

				if ($this.vars.user.tags.blocked.includes(request.data.tag_id))
					request.data.block = {class: 'remove_from_unpopular', text: 'разблокировать'};

				if ($this.vars.user.tags.subscribed.includes(request.data.tag_id))
					request.data.favorite = {class: 'remove_from_fav', text: 'отписаться'};

				// tag desc
				if (request.data.articlePost) {
					const description = $this.posts.attributes(request.data.articlePost, true, 200);
					description[0].classList.add('post_content_cut');

					data.description = description[0].outerHTML;
					data.description_expand = description[1].outerHTML;
				}

				// pagination
				data.pagination = { prev: { href: '', class: '' }, next: { href: '', class: ''	}, expanded: [] };

				const ex = [1, 2];
				const dots = '<span>...</span>';
				const pages = Array.from({length: Math.ceil(request.data.postPager.count/10)}, function(_, i) { return i + 1 })
				if (request.tag_page_num === 0)
					request.tag_page_num = pages.at(-1);

				// prev
				if (request.tag_page_num < pages.at(-1)) {
					if ((request.tag_page_num+1) == pages.at(-1)) {
						data.pagination.prev.href = request.url_path;
					} else {
						data.pagination.prev.href = `${request.url_path}/${request.tag_page_num+1}`;
					}
				} else {
					data.pagination.prev.class = 'current';
				}

				// next
				if (request.tag_page_num > 1) {
					data.pagination.next.href = `${request.url_path}/${request.tag_page_num-1}`;
				} else {
					data.pagination.next.class = 'current';
				}

				// pagination_expanded
				for (let i = 1; i < 3; i++) {
					if (pages.length > 1) {
						const page = pages.at(-i);
						ex.push(page);

						let l;
						if (page == request.tag_page_num) {
							l = `<span class="current">${page}</span>`;
						} else {
							if (page == pages.at(-1)) {
								l = `<a href="${request.url_path}">${page}</a>`;
							} else {
								l = `<a href="${request.url_path}/${page}">${page}</a>`;
							}
						}
						data.pagination.expanded.push(l);
					}
				}

				if (pages.length > 2) {
					const num = pages.indexOf(request.tag_page_num);

					const start = ((num-2) <= 0)?0:(num-3);
					const end = ((num+3) > pages.length)?num:(num+3);

					const tmp = pages.slice(start, end).reverse();
					for (const i in tmp) {
						if (ex.includes(tmp[i]))
							tmp.splice(i, 1);
					}
					
					if (tmp.at(0) < pages.at(-3))
						data.pagination.expanded.push(dots);

					for (const page of tmp) {
						if (ex.includes(page))
							continue;

						let l;
						if (page == request.tag_page_num) {
							l = `<span class="current">${page}</span>`;
						} else {
							l = `<a href="${request.url_path}/${page}">${page}</a>`;
						}
						data.pagination.expanded.push(l);
					}

					if (tmp.at(-2) > pages.at(3))
						data.pagination.expanded.push(dots);
				}

				for (let i = 1; i >= 0; i--) {
					const page = pages.at(i);
					let l;

					if (page == request.tag_page_num) {
						l = `<span class="current">${page}</span>`;
					} else {
						l = `<a href="${request.url_path}/${page}">${page}</a>`;
					}
					data.pagination.expanded.push(l);
				}

				// show tag info
				$('#tagArticle').remove();
				$('#contentinner').prepend($('#JV_tagPage').Container([data]));

				// show pagination
				$('#Pagination').remove();
				$('#contentinner').append($('#JV_pagination').Container([data]));
				
				// tag header image
				$('#contentInnerHeader').on('load', function() {
					$(this).removeAttr('style');
				})				

				$('#post_list').html($('#JV_post').Container(request.data.postPager.posts));

				callback();
			},
			state: function(tag_id, state) {
				switch (state) {
					case 'add_to_fav':
						state = 'SUBSCRIBED';
						break;
					case 'add_to_unpopular':
						state = 'BLOCKED';
						break;
					default:
						state = 'UNSUBSCRIBED';
						break;
				}
				
				engine.runtime.sendMessage({method: 'tag', action: 'state', data: {tag_id: tag_id, state: state}});
				return true;
			}
		}
	}
	get posts() {
		return {
			check: function(item) {
				const post_id = item.attr('id').match(/([0-9]+)$/)[1];

				let old = '';

				let fandomOrTag = false;
				const subdomain = window.location.hostname.match(/^(.*?)\.reactor.*/);
				if (subdomain) {
					if (!['old', 'joy'].includes(subdomain[1]))
						fandomOrTag = true;
					if (subdomain[1] == 'old')
						old = 'old';
				}
				if ($this.url[1] == 'tag')
					fandomOrTag = true;

				// if quick download enabled - make button
				if ($this.vars.options.download_status)
					item.find('.share_buttons').prepend(`<span data-action="download" class="big_button ${old}" title="Скачать все картинки из поста"></span>`);

				if ($this.vars.options.post_share_disabled)
					item.find('.share_buttons > a[class^="share"]').remove();


				// default without exceptions
				let exceptions = [];
				// allow exceptions on all pages
				if ($this.vars.options.tags_exceptions_page == 'all') {
					exceptions = Object.values($this.vars.options.tags_list);
				}
				// exceptions only on tags/fandoms
				if ($this.vars.options.tags_exceptions_page == 'tag' && fandomOrTag) {
					exceptions = Object.values($this.vars.options.tags_list);
				}
				// exceptions not in tags/fandoms
				if ($this.vars.options.tags_exceptions_page == 'notag' && !fandomOrTag) {
					exceptions = Object.values($this.vars.options.tags_list);
				}

				// tags list
				const tags = item.find('.taglist a');

				// tag mark
				if ($this.vars.options.post_tags_mark) {
					for (const tag of tags) {
						const id = parseInt($(tag).attr('data-ids').split(',')[0]);
						
						if ($this.vars.user.tags.subscribed.includes(id))
							$(tag).addClass('subscribed');
						if ($this.vars.user.tags.blocked.includes(id))
							$(tag).addClass('blocked');
					}
				}

				// tags ignore
				if (exceptions.length) {
					for (const tag of tags) {
						const id = parseInt($(tag).attr('data-ids').split(',')[0]);

						if (exceptions.includes(id)) {
							return {post_id: post_id, check: false};
						}
					}
				}


				// disable if post action on tag page, but this is non tag/fandom page
				if ($this.vars.options.post_pages_action == 'tag' && !fandomOrTag) {
					return {post_id: post_id, check: false};
				}
				// disable if post action on non tag page, but this is tag/fandom page
				if ($this.vars.options.post_pages_action == 'notag' && fandomOrTag) {
					return {post_id: post_id, check: false};
				}

				return {post_id: post_id, check: true};
			},
			get: function() {

				// if quick download enabled - make button
				if ($this.vars.options.download_status)
					$('#submenu').append('<span data-action="download" class="big_button" title="Скачать все картинки на странице"></span>');

				// list to check visited
				const get = [];

				// all posts on page
				const posts = $('.postContainer');

				$.each(posts, function() {
					// get post_id and options to check
					const post = $this.posts.check($(this));

					// if this is exception
					if (!post.check) {
						$(this).addClass('JV_exception');
					} else {
						// save globally
						$this.lists.posts[post.post_id] = $(this).find('.ufoot');
					}

					// to check
					get.push(post.post_id);
					
					// post is censored?
					const iscensored = $(this).find('[alt="Copywrite"], [alt="Censorship"]').length;
					if (iscensored) {
						$this.lists.unlock.push(post.post_id);
					}
				});
				
				// translucent animation
				if (posts.length && $this.vars.options.post_action !== 'none' && $this.vars.status && !$this.vars.options.extension_ignore_url.includes($this.url[1])) {
					$('#content').css('opacity', $this.vars.options.post_opacity);
				}

				// to check in history
				engine.runtime.sendMessage({method: 'posts', action: 'get', data: get});
			},
			set: function(data, callback) {

				// if post page - mark post as viewed
				if ($this.url[1] == 'post')
					engine.runtime.sendMessage({action: 'mark', data: $this.url[2]});

				// add info date visited
				if ($this.vars.options.post_visited_date) {
					for (const [post_id, visited] of Object.entries(data)) {
						$(`#postContainer${post_id}`).find('.uhead_nick').append($('#JV_visited').Container([visited]));

						$this.trigger($(`#postContainer${post_id}`)[0]);
					}
				}

				// mark posts
				if ($this.vars.options.post_action !== 'none' && $this.vars.status && !$this.vars.options.extension_ignore_url.includes($this.url[1])) {
					for (const post_id of Object.keys(data)) {

						// remove from visited hendler
						delete $this.lists.posts[post_id];

						// find post on page
						const post = $(`#postContainer${post_id}`);

						// if post is an exception
						if (post.hasClass('JV_exception'))
							continue;

						if ($this.vars.options.post_action_unread) {
							if (post.find('.commentnumDelta').text())
								continue;
						}

						// post actions
						switch ($this.vars.options.post_action) {
							case 'hide':
								// if visited, and need to remove from page - remove from list to unlock censored
								delete $this.lists.unlock[post_id];

								post.remove();
								break;
							case 'translucent':
								post.css('opacity', $this.vars.options.post_opacity);
								break;
							case 'title':
								post.addClass('JV_title');
								break;
							case 'title_translucent':
								post.addClass('JV_title');
								post.css('opacity', $this.vars.options.post_opacity);
								break;
						}
					}
				}

				callback();
			},
			pager: function() {
				// auto step to next page
				// default - disable
				let pager = false;

				// if all posts viewed
				// and page didnt have any exceptions
				if (!Object.keys($this.lists.posts).length && !$('.JV_exception').length) {
					// if allowed on all pages except the first and this not first page
					if ($this.vars.options.post_pager == 'withoutfirst' && document.querySelector('a.prev') !== null)
						pager = true;

					// if allowed on all pages
					if ($this.vars.options.post_pager == 'all')
						pager = true;

				}

				// block tag loop
				if (document.referrer) {
					let referrerURL = new URL(document.referrer);
					let referrer = referrerURL.pathname.split('/');
					let num = parseInt(referrer[3]);
					referrer.splice(3, 1);
					referrer = decodeURI(referrerURL.origin+referrer.join('/'));

					let currentURL = document.location;
					let cpath = currentURL.pathname.split('/');
					cpath.splice(3, 1);
					cpath = decodeURI(currentURL.origin+cpath.join('/'));

					// if the links are same
					// but current page num - undefined
					// and referrer page number - is numeric
					// this is tag loop - disable pager
					if (referrer === cpath && $this.url[3] === undefined && typeof num == 'number' && !isNaN(num))
						pager = false;
				}

				if ($this.vars.options.post_action_unread) {
					$('.postContainer').each(function() {
						if ($(this).find('.commentnumDelta').text())
							pager = false;
					})
				}

				// if pager allowed and next page exists
				if (pager && $('a.next').length) {
					$('a.next')[0].click();
				} else { // else - remove translucent
					$('#content').css('opacity', 1);
				}
			},
			viewed: function(data) {
				// visual mark animation
				if ($this.vars.options.post_visual_mark && data.result && data.post_id in $this.lists.posts) {
					$(`#postContainer${data.post_id}`).addClass('JV_mark');
				}

				delete $this.lists.posts[data.post_id];
			},
			unlock: function(data) {

				for (const [post_id, item] of Object.entries(data)) {

					const post = $(`#postContainer${post_id}`);

					// rebuild comments
					post.find('.toggleComments').removeClass('toggleComments').addClass('JV_toggleComments');

					// rebuild votes
					post.find('.ufoot_first .post_rating').replaceWith($('#JV_rating').Container([item]));

					// get commentnumDelta
					const commentnumDelta = item.commentsCount - item.viewedCommentsCount;
					if (commentnumDelta > 0) {
						post.find('span.commentnumDelta').text(`+${commentnumDelta}`);
					}

					// get real content
					const content = $this.posts.attributes(item);

					// if this is post page - instant load comments
					if ($this.url[1] == 'post')
						post.find('.JV_toggleComments').click();

					// replace plug
					post.find('[alt="Copywrite"], [alt="Censorship"]').replaceWith(content[0], content[1]);

				}

				$this.posts.pager();

				var event = document.createEvent('HTMLEvents');
				event.initEvent('DOMUpdate2', true, true);
				event.eventName = 'DOMUpdate2';
				document.dispatchEvent(event);
			},
			attributes: function(item, isPost = true) {
				if (item === null)
					return ['', '', ''];

				// filename
				let filename = [];
				if ('tags' in item) {
					let num = 3;
					filename = [];
					for (var q of item.tags) {
						if (num < 0)
							break;
						
						q.name = encodeURI(q.name.replaceAll(/[\s]/g, '-').replaceAll(/[/.?#]/g, ''));
						filename.push(q.name);
						num--;
					}
					filename = filename.join('-');
				} else {
					filename = 'image';
				}

				// attributes -> templates
				if (Object.keys(item.attributes).length) {
					for (const attribute of item.attributes) {
						let template_id = '';

						attribute.template = '';
						attribute.filename = filename;

						switch(attribute.type) {
							case 'PICTURE':
								if (isPost) {
									if (['GIF', 'WEBM', 'MP4'].includes(attribute.image.type)) {
										if (attribute.image.type == 'GIF' && !attribute.image.hasVideo) {
											template_id = 'gif';
										} else {
											template_id = 'video';
										}
									} else {
										template_id = 'image_post';
									}
								} else {
									template_id = 'image_comment';
								}
								break;
							case 'YOUTUBE':
								template_id = 'youtube';
								break;
							case 'COUB':
								template_id = 'coub';
								break;
							case 'SOUNDCLOUD':
								template_id = 'soundcloud';
								break;
						}

						attribute.template = $(`#JV_attribute_${template_id}`).Container([attribute]);
					}
				}

				// match all in text
				let toReplace = {};
				const text = item.text.matchAll(/&attribute_insert_([0-9]+)&/g);
				for (const insert of text) {
					toReplace[insert[0]] = insert[1];
				}
				
				// replace attributes in text
				if (Object.keys(toReplace).length) {
					for (const [search, id] of Object.entries(toReplace)) {
						if ((id-1) in item.attributes) {
							item.text = item.text.replace(search, item.attributes[(id-1)].template);
						} else {
							item.text = item.text.replace(search, '<b>[То что здесь должно быть - было удалено]</b>');
						}
					}
				}

				// if unused attributes remain
				if (Object.keys(item.attributes).length > Object.keys(toReplace).length) {
					for (const [id, attribute] of Object.entries(item.attributes)) {
						if (!Object.values(toReplace).includes((id-1)))
							item.text += attribute.template;
					}
				}

				item.text = item.text.replace(/<br>$/, '');

				// re create post content block
				const child = document.createElement('div');
				child.innerHTML = item.text;

				const content = document.createElement('div');
				content.classList.add('post_content');
				content.appendChild(child);

				const expand = document.createElement('div');
				expand.classList.add('post_content_expand');
				
				const textExpand = document.createElement('span');
				textExpand.textContent = 'Развернуть';
				expand.appendChild(textExpand);
				
				return [content, expand, item.text];
			}
		}
	}
	get comments() {
		return {
			set: function(data) {
				const comments = $(`#postContainer${data.post_id}`).find('.post_comment_list');

				// rebuild comments form
				comments.html($('#JV_comments').Container([{
					post_id: data.post_id, 
					user: {id: data.user.id},
					user_id: $this.vars.user.user_id
				}]));

				for (let comment of data.comments) {
					// this is banned comment
					if (comment.parent === null)
						continue;
					
					// content
					comment.text = $this.posts.attributes(comment, false)[2];

					let appendTo = comments.find('.comment_list_post');
					if (comment.parent.__typename !== 'Post') {
						let child = appendTo.find(`#comment_list_comment_${comment.parent.id}`);
						if (!child.length) {
							appendTo.find(`#comment${comment.parent.id}`).after($('#JV_comment_child').Container([comment]));
							appendTo = appendTo.find(`#comment_list_comment_${comment.parent.id}`);
						}
					}

					appendTo.append($('#JV_comment').Container([comment]));
				}

				comments.css('display', 'block');

				$this.trigger(comments[0]);
			},
			add: function(data) {
				fetch('/post_comment/create', {
					method: 'POST',
					body: data
				}).then(function(response) {
					return response.json();
				}).then(function(response) {
					engine.runtime.sendMessage({method: 'comments', action: 'get', data: data.get('post_id')});
				});
			}
		}
	}
	download(button) {

		let items = {};
		const content = button.parents('.postContainer').find('.post_content');

		// find images
		$.each(content.find('img'), function() {
			if (!$(this).attr('src').includes('/post/'))
				return;

			const image_id = $(this).attr('src').match(/([0-9]+)\.[a-z]+$/)[1];
			items[image_id] = window.location.protocol+$(this).attr('src');
		});

		// find full links. if exists - replace
		$.each(content.find('a.prettyPhotoLink, a.video_gif_source'), function() {
			if (!$(this).attr('href').includes('/post/'))
				return;
			
			const image_id = $(this).attr('href').match(/([0-9]+)\.[a-z]+$/)[1];
			items[image_id] = window.location.protocol+$(this).attr('href');
		});

		for (const url of Object.values(items)) {
			const filename = decodeURI(new URL(url).pathname.split('/').pop());
			fetch(url).then(function(response) { 
				return response.blob().then(function(blob) { 
					return { type: response.headers.get('Content-Type'), raw: blob }
				})
			}).then(function(data) {
				engine.runtime.sendMessage({method: 'download', data: {
					filename: filename,
					url: url,
					file: URL.createObjectURL(new Blob([data.raw], {type: data.type}))
				}});
			});
		}
	}
	trigger(element) {
		var event = document.createEvent('HTMLEvents');
		event.initEvent('DOMUpdate', true, true);
		event.eventName = 'DOMUpdate';
		element.dispatchEvent(event);
	}
}

const j = new JV();
j.init();