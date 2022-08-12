var $posts = {};
var $options = {};
var $data = [];

function post(item) {
	let post_id = parseInt(item.querySelector('.ufoot a.link[href*="post"]').href.match(/([0-9]+)$/)[1]);
	
	// default without exceptions
	let exceptions = [];
	// allow exceptions on all pages
	if ($options.exceptions == 'all') {
		exceptions = $options.tags;
	}
	// exceptions only on tags/fandoms
	if ($options.exceptions == 'tag' && document.getElementById('tagArticle') !== null) {
		exceptions = $options.tags;
	}
	// exceptions not in tags/fandoms
	if ($options.exceptions == 'notag' && document.getElementById('tagArticle') == null) {
		exceptions = $options.tags;
	}

	if (exceptions.length > 0) {
		let tags = item.getElementsByClassName('taglist')[0].getElementsByTagName('a');

		// tags ignore
		for (const [k, tag] of Object.entries(tags)) {
			if (exceptions.includes(tag.textContent)) {
				return false;			
			}
		}
	}

	return post_id;
}

chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
	sendResponse(true);

	switch (request.action) {
		case 'reload': // if settings changed, need reload
			window.location.reload();
			break;
		case 'start': // received message to launch
			// save options
			$options = request.options;
			$data = request.data;

			// disallow for single post, userpage, tagpage, discussion list, users list
			if (!['post', 'user', 'tag', 'discussion', 'people'].includes(window.location.pathname.split('/')[1])) {

				let items = Object.entries(document.getElementsByClassName('postContainer'));

				// translucent animation
				if (items.length > 0) {
					document.getElementById('content').style.opacity = $options.opacity;
				}

				for (const [key, item] of items) {
					// check every post
					let post_id = post(item);

					// if didnt have exceptions
					if (post_id) {
						// if visited					
						if ($data.includes(post_id)) {
							let post_block = document.getElementById('postContainer'+post_id);
							switch ($options.post) {
								case 'hide':
									post_block.remove();
									break;
								case 'translucent':
									post_block.style.opacity = $options.opacity;
									break;
								case 'title':
									post_block.classList.add('JV_title');
									break;
								case 'title_translucent':
									post_block.classList.add('JV_title');
									post_block.style.opacity = $options.opacity;
									break;
							}

							// return to defaults on click
							post_block.addEventListener('click', function() {
								this.classList.remove('JV_title');
								this.style.opacity = 1;
							});

							// kick from exec
							delete $posts[post_id];
						} else {
							// track by post footer
							$posts[post_id] = item.getElementsByClassName('ufoot')[0];
						}
					} else {
						item.classList.add('JV_exception');
					}
				}

				// auto step to next page
				// default - disable
				let pager = false;

				// if all posts viewed
				// and page didnt have any exceptions
				if (Object.keys($posts).length == 0 && document.getElementsByClassName('JV_exception').length == 0) {
					// if allowed on all pages except the first
					if ($options.pager == 'withoutfirst') {
						// if this not first page
						if (document.querySelector('a.prev') !== null) {
							pager = true;
						}
					}
					// if allowed on all pages
					if ($options.pager == 'all') {
						pager = true;
					}
				}

				// if pager allowed and next page exists 
				if (pager && document.querySelector('a.next') !== null) {
					document.querySelector('a.next').click();
				} else { // else - remove translucent
					document.getElementById('content').style.opacity = 1;
				}
			}
			break;
	}
	return true;
});

window.addEventListener('scroll', function() {
	// check all posts
	for (let post_id in $posts) {
		// get position on page
		let position = $posts[post_id].getBoundingClientRect();
		// if the block is fully visible on screen
		if (position.top > 0 && position.bottom <= window.innerHeight) {
			// mark post as viewed
			$data.push(post_id);
			chrome.runtime.sendMessage({action: 'mark', data: post_id});
			// kick from exec
			delete $posts[post_id];
		}
	};
});

// start?
chrome.runtime.sendMessage({action: 'start'});
