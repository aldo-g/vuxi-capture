async function installInteractionGuards(context) {
  await context.addInitScript(() => {
    window.addEventListener(
      'submit',
      event => {
        event.preventDefault();
      },
      true
    );

    const preventLinkNavigation = event => {
      const anchor = event.target?.closest?.('a[href]');
      if (!anchor) {
        return;
      }

      const href = anchor.getAttribute('href') || '';
      if (!href || href.startsWith('#') || /^javascript:/i.test(href)) {
        return;
      }

      try {
        const linkUrl = new URL(href, window.location.href);
        const samePage =
          linkUrl.origin === window.location.origin &&
          linkUrl.pathname === window.location.pathname;
        if (!samePage) {
          event.preventDefault();
        }
      } catch {
        event.preventDefault();
      }
    };

    window.addEventListener('click', preventLinkNavigation, true);
    window.addEventListener('auxclick', preventLinkNavigation, true);
  });
}

module.exports = { installInteractionGuards };
