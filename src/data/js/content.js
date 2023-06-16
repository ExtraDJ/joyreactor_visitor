const getEngine = function() {
	if (typeof browser !== 'undefined') { return browser; }
	return chrome;
}
const engine = getEngine();

$.fn.Container = function(data, html) {
	if (html === undefined) {
		html = false;
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
	const regex = /{{\s*([~\w\.\[\]]+)\s*}}/gm;
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
							collection = $('#'+path[++tp_level]).Container(collection[path[level]], true);
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
		this.posts = {};
		this.unlock = [];
		this.options = {};
		this.url = window.location.pathname.split('/');

		this.user_id;
		this.server_time;
		this.tags = {
			subscribed: {},
			blocked: {}
		}
	}
	async init() {
		const $this = this;

		$this.loadTemplates();
		$this.handler();

		/*
		* steps to exec
		* 1. send server time to service_worker
		* 2. get cached personal info from service_worker
		* 3. if no cache - get it and send to service_worker, then cached
		* 4. get extension options
		* 5. check, this is redirected from tagpage
		* 6. rebuild tagpage (optional)
		* 7. find all posts to check visited, list of posts to unlock -> mark tags, download button, exceptions
		* 8. unlock posts
		* 9. ????
		* 10. will fuck a duck
		*/

		// if post page - mark post as viewed
		if (['post'].includes($this.url[1]))
			engine.runtime.sendMessage({action: 'mark', data: $this.url[2]});

		// do not run if image
		if (!['pics', 'images'].includes($this.url[1])) {
			// get and set server time
			$this.server_time = parseInt(document.documentElement.outerHTML.match(/server_time = ([0-9]+);/)[1]);
			engine.runtime.sendMessage({action: 'time', data: $this.server_time});

			// get user_id and subscribed/blocked tags
			engine.runtime.sendMessage({action: 'me'});
		}
	}
	handler() {
		const $this = this;

		engine.runtime.onMessage.addListener(async function(request) {
			switch (request.action) {
				case 'me': // cached user data
					if (await $this.me(request.data)) {
						engine.runtime.sendMessage({action: 'options'});
					}
					break;
				case 'options': // received options
					// save options
					$this.options = request.data;
					// if this is redirected
					if (window.location.href.includes('JV=tag')) {
						engine.runtime.sendMessage({action: 'tag', url: document.referrer});
					} else {
						// this is normal page
						$this.postsExec();
					}
					break;
				case 'check': // we received visited posts
					$this.check(request.data);
					break;
				case 'unlock': // unlock posts
					$this.unlockExec(request.data);
					break;
				case 'tag': // unlock tag page 
					$this.tag(request);
					break;
				case 'reload': // if settings changed - reload page
					window.location.reload();
					break;
			}
			return true;
		});
	
		// scroll visitor handler
		$(window).on('scroll', function() {
			if ($(window).scrollTop() < 200)
				return false;

			// check all posts
			for (const [post_id, item] of Object.entries($this.posts)) {
				// if the block is fully visible on screen				
				if ((item.offset().top + item.height()) < ($(window).height() + $(window).scrollTop())) {
					// mark post as viewed
					engine.runtime.sendMessage({action: 'mark', data: post_id});
					// kick from exec
					delete $this.posts[post_id];
				}
			}
		});

		// tag subscribe/unsubscribe/block
		$(document).on('click', '[data-tag_id]', function(event) {
			event.preventDefault();
			$this.changeTagState($(this));
		});
		// get comments list
		$(document).on('click', '.JV_toggleComments', async function(event) {
			event.preventDefault();

			const post_id = $(this).attr('href').match(/([0-9]+)/)[1];
			const comments = $(`#postContainer${post_id}`).find('.post_comment_list');

			if ($(this).hasClass('comOpened')) {
				comments.css('display', 'none');
				$(this).removeClass('comOpened');
				return false;
			}

			await $this.getComments(post_id);
			comments.css('display', 'block');
			$(this).addClass('comOpened');
		});
		// send comment
		$(document).on('click', '.JV_submit', function() {
			$this.sendComment(new FormData($(this).parent('form')[0]))
		});
		// download all post content
		$(document).on('click', '[data-action="download"]', function() {
			$this.download($(this));
		});
		// tag subscribe/unsubscribe/block, login, logout - flush cache
		$(document).on('click', '.change_favorite_link, #logout, input[value="Войти"]', function() {
			engine.runtime.sendMessage({action: 'me', data: 'flush'});
		});
		// shortcut download
		$(document).on('keydown', function(event) {
			if (event.keyCode == 83 && event.ctrlKey && event.shiftKey) {
				let button;
				if ($this.url[1] == 'post') {
					button = $('[data-action="download"]');
				} else {
					let minDistance = 50000;

					// get button closest to center
					$.each($('[data-action="download"]'), function() {
						let distance = Math.abs(($(this).offset().top + $(this).height()) - (($(window).height() / 2) + $(window).scrollTop()));
						if (minDistance > distance && $(window).scrollTop() < $(this).offset().top) {
							minDistance = distance;
							button = $(this);
						}
					});
				}
				button.click();
			}
		});
	}
	loadTemplates() {
		fetch(engine.runtime.getURL('data/templates.html'), {}).then(response => response.text()).then(function(response) {
			document.getElementsByTagName('body')[0].append(new DOMParser().parseFromString(response, 'text/html').getElementsByTagName('templates')[0]);
		});		
	}
	async me(cache) {
		const $this = this;
		return new Promise(function(resolve) {
			if (typeof cache === 'boolean') {
				fetch('https://api.joyreactor.cc/graphql', {
					method: 'POST',
					credentials: 'include',
					headers: {
						'Content-Type': 'application/json'
					},
					body: JSON.stringify({query: `{ me { user { id } blockedTags { id name synonyms } subscribedTags { id name synonyms } } }`})
				}).then(response => response.json()).then(function(response) {
					let data = {
						user_id: atob(response.data.me.user.id).match(/([0-9]+)/)[1],
						tags: {
							blocked: {},
							subscribed: {}
						}
					}
					if (response.data.me !== null) {
						data.user_id = atob(response.data.me.user.id).match(/([0-9]+)/)[1];
						for (const item of response.data.me.blockedTags) {
							data.tags.blocked[atob(item.id).match(/([0-9]+)/)[1]] = `${item.name}, ${item.synonyms}`.split(',').map(function(e) { return e.trim() }).filter(function(e) { return e != ''; });
						}
						for (const item of response.data.me.subscribedTags) {
							data.tags.subscribed[atob(item.id).match(/([0-9]+)/)[1]] = `${item.name}, ${item.synonyms}`.split(',').map(function(e) { return e.trim() }).filter(function(e) { return e != ''; });
						}
					}

					engine.runtime.sendMessage({action: 'me', data: data});

					resolve(false);
				});
			} else {
				$this.user_id = cache.user_id;
				$this.tags = cache.tags;

				resolve(true);
			}
		});
	}
	postsExec() {
		const $this = this;

		// list to check visited
		const check = [];

		// all posts on page
		const posts = $('.postContainer');

		$.each(posts, function() {

			// get post_id and options to check
			const post = $this.postData($(this));

			// if didnt have exceptions
			if (post.check) {
				check.push(post.post_id);

				// save globally
				$this.posts[post.post_id] = $(this).find('.ufoot');
			}  else {
				$(this).addClass('JV_exception');
			}

			// post is censored?
			const iscensored = $(this).find('[alt="Copywrite"], [alt="Censorship"]').length;
			if (iscensored) {
				$this.unlock.push(post.post_id);
			}
		});


		// disallow for some pages types
		if (!$this.options.ignore_url.includes($this.url[1])) {
			// translucent animation
			if (posts.length) {
				$('#content').css('opacity', $this.options.opacity);
			}

			// to check visited
			engine.runtime.sendMessage({action: 'check', data: check});

		} else {
			// if no need to hide visited - launch to unlock censored
			if ($this.unlock.length)
				engine.runtime.sendMessage({action: 'unlock', data: $this.unlock});
		}
	}
	postData(item) {
		const $this = this;

		const post_id = item.attr('id').match(/([0-9]+)$/)[1];

		if ($this.options.download == 'enabled')
			item.find('.share_buttons').prepend('<a data-action="download" title="Скачать все картинки из поста"></a>');

		// default without exceptions
		let exceptions = [];
		// allow exceptions on all pages
		if ($this.options.exceptions == 'all') {
			exceptions = $this.options.tags;
		}
		// exceptions only on tags/fandoms
		if ($this.options.exceptions == 'tag' && $('#tagArticle').length) {
			exceptions = $this.options.tags;
		}
		// exceptions not in tags/fandoms
		if ($this.options.exceptions == 'notag' && !$('#tagArticle').length) {
			exceptions = $this.options.tags;
		}

		const tags = item.find('.taglist a');

		// tags ignore
		for (const tag of tags) {
			const name = $(tag).text();
			if ($this.options.tag_mark == 'enabled') {
				if (Object.values($this.tags.subscribed).find(function(e) { return e.includes(name); }))
					$(tag).addClass('subscribed');
				if (Object.values($this.tags.blocked).find(function(e) { return e.includes(name); }))
					$(tag).addClass('blocked');
			}

			if (exceptions.length) {
				if (exceptions.includes(name.toLowerCase())) {
					return {post_id: post_id, check: false};
				}
			}
		}

		if ($this.options.page_action == 'tag' && !$('#tagArticle').length) {
			return {post_id: post_id, check: false};
		}
		if ($this.options.page_action == 'notag' && $('#tagArticle').length) {
			return {post_id: post_id, check: false};
		}

		return {post_id: post_id, check: true};
	}
	check(data) {
		const $this = this;

		// all recived data - visited
		for (const [post_id, visited] of Object.entries(data)) {

			// remove from visited hendler
			delete $this.posts[post_id];
			// if visited - remove from list to unlock censored
			delete $this.unlock[post_id];

			const post = $(`#postContainer${post_id}`);

			// add info date visited
			post.find('.uhead_nick').append($('#JV_visited').Container([visited], true));

			switch ($this.options.post) {
				case 'hide':
					post.remove();
					break;
				case 'translucent':
					post.css('opacity', $this.options.opacity);
					break;
				case 'title':
					post.addClass('JV_title');
					break;
				case 'title_translucent':
					post.addClass('JV_title');
					post.css('opacity', $this.options.opacity);
					break;
			}

			// return to defaults on click
			post.on('click', function() {
				$(this).removeClass('JV_title');
				$(this).css('opacity', 1);
				$(this).find('.post_content').css('max-height', '100%');
				$(this).find('.post_content_expand').css('display', 'none');
			});
		}

		// auto step to next page
		// default - disable
		let pager = false;

		// if all posts viewed
		// and page didnt have any exceptions
		if (Object.keys($this.posts).length == 0 && $('.JV_exception').length == 0) {
			// if allowed on all pages except the first
			if ($this.options.pager == 'withoutfirst') {
				// if this not first page
				if (document.querySelector('a.prev') !== null) {
					pager = true;
				}
			}
			// if allowed on all pages
			if ($this.options.pager == 'all') {
				pager = true;
			}
		}

		// if pager allowed and next page exists 
		if (pager && $('a.next').length) {
			let num = parseInt(new URL(document.referrer).pathname.split('/')[3]);
			if (!($this.url[3] === undefined && typeof num == 'number' && !isNaN(num))) {
				$('a.next')[0].click();
			}
		} else { // else - remove translucent
			$('#content').css('opacity', 1);

			// lets unlock censored posts
			if ($this.unlock.length)
				engine.runtime.sendMessage({action: 'unlock', data: $this.unlock});
		}
	}
	async unlockExec(data) {
		const $this = this;

		let info = {posts: {}};
		let postIds = [];
		for (const [post_id, item] of Object.entries(data)) {
			if (!$(`#postContainer${post_id}`).find('.ufoot_first .vote-plus').length)
				postIds.push(post_id);
		}

		if (Object.keys(postIds).length)
			info = await $this.personalInfo(postIds);

		for (const [post_id, item] of Object.entries(data)) {

			const post = $(`#postContainer${post_id}`);

			// if censored - rebuild comments
			post.find('.toggleComments').removeClass('toggleComments').addClass('JV_toggleComments');

			if (['post'].includes($this.url[1])) {
				post.find('.JV_toggleComments').click();
			}

			// rebuild votes and get commentnumDelta
			if (post_id in info) {
				let vote = {};
				if (info[post_id].votes.vote === null) {
					vote.rating = '--';
				} else {
					if (info[post_id].votes.rating > 0) {
						vote.rating = info[post_id].votes.rating.toFixed(1);	
					} else {
						if (post.find('.ufoot_first .post_rating').length)
							vote.rating = parseFloat(post.find('.ufoot_first .post_rating').text().match(/([0-9\.]+)/)[1]).toFixed(1);
					}
					if (info[post_id].votes.vote > 0) {
						vote.vote_minus = 'vote-change';
					} else {
						vote.vote_plus = 'vote-change';
					}
				}
				post.find('.ufoot_first .post_rating').html($('#JV_rating').Container([vote], true));

				const commentnumDelta = info[post_id].comments.commentsCount - info[post_id].comments.viewedCommentsCount;
				if (commentnumDelta > 0) {
					post.find('span.commentnumDelta').text(`+${commentnumDelta}`);
				}
			}

			// post content
			const data = $this.setAttributes(item);
			if (['post'].includes($this.url[1])) {
				data[0].classList.add('allow_long');
			}

			post.find('[alt="Copywrite"], [alt="Censorship"]').replaceWith(data[0], data[1]);
		}

		var event = document.createEvent('HTMLEvents');
		event.initEvent('DOMUpdate2', true, true);
		event.eventName = 'DOMUpdate2';
		document.dispatchEvent(event);
	}
	async tag(request) {
		const $this = this;

		// if redirect to subdomain
		if (new URL(request.url).hostname !== window.location.hostname) {
			window.location = request.url;
			return;
		}

		// set page url
		window.history.replaceState('tagPage', '', request.url);

		// set page title
		document.title = `${request.data.name} | JoyReactor`;

		// menu links
		const link = request.data.seoName.replaceAll(' ', '+');
		const links = $('#submenu [href]');
		$.each(links, function() {
			if ($(this).attr('href') == 'http://m.joyreactor.cc/top') {
				$(this).parent('div').remove();
				return;
			}

			$(this).parent('div').removeClass('active');

			$(this).text($(this).text().replace(/ \([0-9\+]+\)/, ''));

			// re build links and mark as active
			const last = $(this).attr('href').split('/').pop();
			if (['new', 'best', 'all'].includes(last)) {
				if (request.type == last)
					$(this).parent('div').addClass('active');

				$(this).attr('href', `/tag/${link}/${last}`);
			} else {
				if (request.type == 'good')
					$(this).parent('div').addClass('active');

				$(this).attr('href', `/tag/${link}`);
			}
		});

		// remove trends
		$('.trends_wr').remove();

		// data for template
		let data = request.data;

		data.tag_id = atob(request.data.id).match(/([0-9]+)/)[1];

		// breadcrumbs
		data.breadcrumbs = [{url: 'https://joyreactor.cc/', name: 'Главная'}];
		data.breadcrumbsCurrent = '';

		while (request.data.hierarchy.length) {
			const tag = request.data.hierarchy.pop();
			const link = tag.seoName.replaceAll(' ', '+');

			if (!request.data.hierarchy.length) {
				data.breadcrumbsCurrent = tag.name;
			} else {
				data.breadcrumbs.push({url: `/tag/${link}`, name: tag.name})
			}
		}

		// tag desc
		if (request.data.articlePost) {
			const description = $this.setAttributes(request.data.articlePost, true, 200);
			description[0].classList.add('post_content_cut');

			data.description = description[0].outerHTML;
			data.description_expand = description[1].outerHTML;
		}

		// info about user favorite/blocked tags and post votes
		let postIds = [];
		for (const post of request.data.postPager.posts) {
			postIds.push(atob(post.id).match(/([0-9]+)/)[1]);
		}

		const info = await $this.personalInfo(postIds);

		// subscribe/block tag
		data.favorite = {class: 'add_to_fav', text: 'подписаться'};
		data.block = {class: 'add_to_unpopular', text: 'заблокировать'};

		if (data.tag_id in $this.tags.blocked) {
			data.block = {class: 'remove_from_unpopular', text: 'разблокировать'};
		}
		if (data.tag_id in $this.tags.subscribed) {
			data.favorite = {class: 'remove_from_fav', text: 'отписаться'};
		}	

		// pagination
		data.pagination = { prev: { href: '', class: '' }, next: { href: '', class: ''	}, expanded: [] };

		const ex = [1, 2];
		const dots = '<span>...</span>';
		const pages = Array.from({length: Math.ceil(request.data.postPager.count/10)}, function(_, i) { return i + 1 })
		if (request.page === 0)
			request.page = pages.at(-1);

		// prev
		if (request.page < pages.at(-1)) {
			if ((request.page+1) == pages.at(-1)) {
				data.pagination.prev.href = request.path;
			} else {
				data.pagination.prev.href = `${request.path}/${request.page+1}`;
			}
		} else {
			data.pagination.prev.class = 'current';
		}

		// next
		if (request.page > 1) {
			data.pagination.next.href = `${request.path}/${request.page-1}`;
		} else {
			data.pagination.next.class = 'current';
		}

		// pagination_expanded
		for (let i = 1; i < 3; i++) {
			if (pages.length > 1) {
				const page = pages.at(-i);
				ex.push(page);

				let l;
				if (page == request.page) {
					l = `<span class="current">${page}</span>`;
				} else {
					if (page == pages.at(-1)) {
						l = `<a href="${request.path}">${page}</a>`;
					} else {
						l = `<a href="${request.path}/${page}">${page}</a>`;
					}
				}
				data.pagination.expanded.push(l);
			}
		}

		if (pages.length > 2) {
			const num = pages.indexOf(request.page);

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
				if (page == request.page) {
					l = `<span class="current">${page}</span>`;
				} else {
					l = `<a href="${request.path}/${page}">${page}</a>`;
				}
				data.pagination.expanded.push(l);
			}

			if (tmp.at(-2) > pages.at(3))
				data.pagination.expanded.push(dots);
		}

		for (let i = 1; i >= 0; i--) {
			const page = pages.at(i);
			let l;

			if (page == request.page) {
				l = `<span class="current">${page}</span>`;
			} else {
				l = `<a href="${request.path}/${page}">${page}</a>`;
			}
			data.pagination.expanded.push(l);
		}

		// show tag info
		$('#tagArticle').remove();
		$('#contentinner').prepend($('#JV_tagPage').Container([data], true));

		// show pagination
		$('#Pagination').remove();
		$('#contentinner').append($('#JV_pagination').Container([data], true));
		
		// tag header image
		$('#contentInnerHeader').on('load', function() {
			$(this).removeAttr('style');
		})
		
		// posts
		let postsData = [];
		for (const post of request.data.postPager.posts) {
			post.user.id = atob(post.user.id).match(/([0-9]+)/)[1];
			post.post_id = atob(post.id).match(/([0-9]+)/)[1];

			// tags
			post.tagsList = [];
			for (const tag of post.tags) {
				const tagIds = [];
				for (var i of tag.hierarchy) {
					tagIds.push(atob(i.id).match(/([0-9]+)/)[1]);
				}
				post.tagsList.push({
					name: tag.name,
					ids: tagIds.join(','),
					link: tag.seoName.replaceAll(' ', '+')
				});
			}

			// added date/time/unix
			const date = new Date(post.createdAt);
			post.date = date.toLocaleString('en-GB', {day:'2-digit', month:'short', year:'numeric'}).replaceAll(' ', '.').replaceAll(',.', ' ');
			post.time = date.getHours()+':'+('0'+date.getMinutes()).slice(-2);
			post.timestamp = Math.floor(new Date(date).getTime() / 1000);


			// votes
			post.vote = [{}];
			if (info[post.post_id].votes.vote === null) {
				post.vote[0].rating = '--';
			} else {
				post.vote[0].rating = post.rating.toFixed(1);
				if (info[post.post_id].votes.vote > 0) {
					post.vote[0].vote_minus = 'vote-change';
				} else {
					post.vote[0].vote_plus = 'vote-change';
				}
			}

			postsData.push(post);
		}

		$('#post_list').html($('#JV_post').Container(postsData, true));

		// we are ready
		$this.postsExec();
	}
	setAttributes(item, isPost = true) {
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
				
				q.seoName = encodeURI(q.seoName.replaceAll(/[\s]/g, '-').replaceAll(/[\/\.\?\#]/g, ''));
				filename.push(q.seoName);
				num--;
			}
			filename = filename.join('-');
		} else {
			filename = 'image';
		}

		// attributes
		let attributes = {};
		let i = 1;

		if (Object.keys(item.attributes).length) {
			for (const attribute of item.attributes) {
				const block = document.createElement('div');
				block.classList.add('image');

				switch(attribute.type) {
					case 'PICTURE':
						const image_id = atob(attribute.id).match(/([0-9]+)/)[1];

						// img element
						let img = document.createElement('img');

						if (isPost) {
							img.src = `//img10.reactor.cc/pics/post/${filename}-${image_id}.jpg`;

							// parent link full image
							let link = document.createElement('a');
							link.href = `//img10.reactor.cc/pics/post/full/${filename}-${image_id}.jpg`;
							link.setAttribute('rel', 'prettyPhoto');
							link.appendChild(img);

							block.appendChild(link);
						} else {
							img.src = `//img2.reactor.cc/pics/comment/${filename}-${image_id}.jpg`;

							block.appendChild(img);
						}
						break;
					case 'YOUTUBE':
						let youtube = document.createElement('iframe');
						youtube.classList.add('youtube-player');

						youtube.setAttribute('type', 'text/html');
						youtube.setAttribute('width', 560);
						youtube.setAttribute('height', 315);
						youtube.setAttribute('frameborder', 0);
						youtube.setAttribute('allowfullscreen', 'allowfullscreen');
						youtube.setAttribute('src', `https://www.youtube.com/embed/${attribute.value}?wmode=transparent&amp;rel=0`);

						block.appendChild(youtube);
						break;
					case 'COUB':
						let coub = document.createElement('iframe');

						coub.setAttribute('width', 640);
						coub.setAttribute('height', 360);
						coub.setAttribute('frameborder', 0);
						coub.setAttribute('allowfullscreen', true);
						coub.setAttribute('src', `https://coub.com/embed/${attribute.value}?muted=false&amp;autostart=false&amp;originalSize=false&amp;startWithHD=false&amp;wmode=opaque`);

						block.appendChild(coub);
						break;
					case 'SOUNDCLOUD':
						attribute.value = JSON.parse(attribute.value);
						let soundcloud = document.createElement('iframe');

						soundcloud.setAttribute('width', '100%');
						soundcloud.setAttribute('height', attribute.value.height);
						soundcloud.setAttribute('scrolling', 'no');
						soundcloud.setAttribute('frameborder', 'no');
						soundcloud.setAttribute('allow', 'autoplay');
						
						soundcloud.setAttribute('src', `https://w.soundcloud.com/player/?url=${attribute.value.url}&amp;color=#ff5500&amp;auto_play=false&amp;hide_related=false&amp;show_comments=true&amp;show_user=true&amp;show_reposts=false&amp;show_teaser=true&amp;visual=true`);

						block.appendChild(soundcloud);
						break;
				}

				attributes[i] = block.outerHTML;
				i++;
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
				if (id in attributes) {
					item.text = item.text.replace(search, attributes[id]);
				} else {
					item.text = item.text.replace(search, '<b>[То что здесь должно быть - было удалено]</b>');
				}
			}
		}

		// if unused attributes remain
		if (Object.keys(attributes).length > Object.keys(toReplace).length) {
			for (const [id, replace] of Object.entries(attributes)) {
				if (!Object.values(toReplace).includes(id))
					item.text += replace;
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
	async personalInfo(postIds) {
		return new Promise(function(resolve) {
			const params = [];
			for (const post_id of postIds) {
				params.push(`post${post_id}:node(id:"${btoa(`Post:${post_id}`)}") { ... on Post { rating vote { power } commentsCount viewedCommentsCount } }`);
			}

			fetch('https://api.joyreactor.cc/graphql', {
				method: 'POST',
				credentials: 'include',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({query: `{ ${params.join(' ')} }`})
			}).then(response => response.json()).then(function(response) {
				const data = {};

				for (const [key, item] of Object.entries(response.data)) {
					if (!key.match(/[0-9]+/))
						continue;

					const post_id = key.match(/[0-9]+/)[0];

					data[post_id] = {
						votes: {rating: item.rating},
						comments: {commentsCount: item.commentsCount, viewedCommentsCount: item.viewedCommentsCount}
					};

					if (item.vote === null) {
						data[post_id].votes.vote = null;
					} else {
						data[post_id].votes.vote = item.vote.power;
					}
				}

				resolve(data);
			});
		});
	}
	changeTagState(button) {
		const tag_id = button.attr('data-tag_id');
		let requestedState;

		if (button.parent().hasClass('add_to_fav'))
			requestedState = 'SUBSCRIBED';
		if (button.parent().hasClass('remove_from_fav'))
			requestedState = 'UNSUBSCRIBED';
		if (button.parent().hasClass('add_to_unpopular'))
			requestedState = 'BLOCKED';
		if (button.parent().hasClass('remove_from_unpopular'))
			requestedState = 'UNSUBSCRIBED';
		
		
		fetch('https://api.joyreactor.cc/graphql', {
			method: 'POST',
			credentials: 'include',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				query: 'mutation FavoriteBlogMutation($id: ID! $requestedState: FavoriteTagState!) { favoriteTag(id: $id, requestedState: $requestedState) { __typename } }',
				variables: {id: btoa(`Tag:${tag_id}`), requestedState: requestedState}
			})
		}).then(function() {
			window.location.reload();
		});
	}
	async getComments(post_id) {
		const $this = this;
		const comments = $(`#postContainer${post_id}`).find('.post_comment_list');
		return new Promise(function(resolve) {
			
			const params = `{
					node(id: "${btoa(`Post:${post_id}`)}") { 
						... on Post { 
							viewedCommentsAt
							user { id }
							comments { 
								id
								level 
								parent {
									__typename
									id
								}
								user { id username }
								createdAt 
								rating 
								text 
								attributes { 
									id
									type
									image { height }
									...Attribute_attribute
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
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({query: params})
			}).then(response => response.json()).then(function(response) {
				comments.html($('#JV_comments').Container([{
					post_id: post_id, 
					user: {id: atob(response.data.node.user.id).match(/([0-9]+)/)[1]}
				}], true));

				const viewed = Math.floor(new Date(response.data.node.viewedCommentsAt).getTime() / 1000);

				for (let comment of response.data.node.comments) {
					if (comment.parent === null)
						continue;
					
					comment.post_id = post_id;
					comment.id = atob(comment.id).match(/([0-9]+)/)[1];
					comment.parent.id = atob(comment.parent.id).match(/([0-9]+)/)[1];
					comment.user.id = atob(comment.user.id).match(/([0-9]+)/)[1];
					comment.rating = comment.rating.toFixed(1);

					const date = new Date(comment.createdAt);
					comment.date = date.toLocaleString('en-GB', {day:'2-digit', month:'short', year:'numeric'}).replaceAll(' ', '.').replaceAll(',.', ' ');
					comment.time = date.getHours()+':'+('0'+date.getMinutes()).slice(-2);
					comment.timestamp = Math.floor(new Date(date).getTime() / 1000);

					comment.text = $this.setAttributes(comment, false)[2];

					if (comment.timestamp > viewed) {
						if ($this.user_id == comment.user.id) {
							comment.class = 'new_my new';
						} else {
							comment.class = 'new';
						}
					}			

					let appendTo = comments.find('.comment_list_post');
					if (comment.parent.__typename !== 'Post') {
						let child = appendTo.find(`#comment_list_comment_${comment.parent.id}`);
						if (!child.length) {
							appendTo.find(`#comment${comment.parent.id}`).after($('#JV_comment_child').Container([comment], true));
							appendTo = appendTo.find(`#comment_list_comment_${comment.parent.id}`);
						}
					}
					appendTo.append($('#JV_comment').Container([comment], true));
				}

				var event = document.createEvent('HTMLEvents');
				event.initEvent('DOMUpdate', true, true);
				event.eventName = 'DOMUpdate';
				document.dispatchEvent(event);

				resolve();
			});
		});
	}
	sendComment(formData) {
		const $this = this;

		fetch('/post_comment/create', {
			method: 'POST',
			body: formData
		}).then(function() {
			$this.getComments(formData.get('post_id'));
		});
	}
	download(button) {

		let items = {};
		const content = button.parents('.postContainer').find('.post_content');

		$.each(content.find('img'), function() {
			const image_id = $(this).attr('src').match(/([0-9]+)\.[a-z]+$/)[1];
			items[image_id] = window.location.protocol+$(this).attr('src');
		});
		$.each(content.find('a.prettyPhotoLink, a.video_gif_source'), function() {
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
				engine.runtime.sendMessage({action: 'download', data: {
					filename: filename,
					url: url,
					data: URL.createObjectURL(new Blob([data.raw], {type: data.type}))
				}});
			});
		}
	}
}

const j = new JV();
j.init();