/**
 * PRATYAKSHA live evaluation task suite.
 *
 * Each task:
 *   id, category       stable identifiers used in reports and --only
 *   startUrl           fixture path (served locally) or absolute URL
 *   live               true when the task needs the public internet
 *   prompt             what the user would type into the side panel
 *   expect.success     the finish_task(success) value a correct run reports
 *   expect.answer      terms the final summary must contain (case-insensitive)
 *   check(page)        optional page-state check run after the agent stops
 */

export const TASKS = [
  {
    id: 'kb-search-answer',
    category: 'search-and-answer',
    startUrl: '/kb-search.html',
    prompt: 'Search this knowledge base for "Kestrel", open the Kestrel 3 article and tell me the year Kestrel 3 was released.',
    expect: { success: true, answer: ['2019'] }
  },
  {
    id: 'wikipedia-answer',
    category: 'search-and-answer',
    live: true,
    startUrl: 'https://en.wikipedia.org/wiki/Main_Page',
    prompt: 'Use Wikipedia search to find the article about the Eiffel Tower and tell me in which year its construction was completed.',
    expect: { success: true, answer: ['1889'] }
  },
  {
    id: 'shipping-form-select',
    category: 'form-with-select',
    startUrl: '/shipping-form.html',
    prompt: 'Fill in the shipping form: full name "Asha Rao", country India, shipping speed Express. Then save the shipping details.',
    expect: { success: true },
    async check(page) {
      const s = await page.evaluate(() => window.__evalState?.submitted || null);
      const ok = !!s && s.fullname === 'Asha Rao' && s.country === 'IN' && s.speed === 'express';
      return { ok, detail: s ? JSON.stringify(s) : 'form was not submitted' };
    }
  },
  {
    id: 'cookie-banner-read',
    category: 'cookie-banner',
    startUrl: '/cookie-news.html',
    prompt: 'Read the Desert Lights festival article on this page and tell me in which city the festival takes place.',
    expect: { success: true, answer: ['Udaipur'] },
    async check(page) {
      const s = await page.evaluate(() => window.__evalState || null);
      return { ok: !!s?.consent, detail: s?.consent ? `consent=${s.consent}` : 'banner never dismissed' };
    }
  },
  {
    id: 'settings-modal',
    category: 'modal-flow',
    startUrl: '/settings-modal.html',
    prompt: 'Turn on the weekly digest email in the notification preferences and save. Leave product announcements as they are.',
    expect: { success: true },
    async check(page) {
      const s = await page.evaluate(() => window.__evalState || null);
      const ok = !!s?.saved && s.digest === true && s.announce === true;
      return { ok, detail: s ? JSON.stringify(s) : 'preferences not saved' };
    }
  },
  {
    id: 'shop-multipage',
    category: 'multi-page-navigation',
    startUrl: '/shop/index.html',
    prompt: 'In this store, go to the Laptops category, open the Orion 14 product page and tell me its battery capacity.',
    expect: { success: true, answer: ['72'] },
    async check(page) {
      const url = page.url();
      return { ok: url.endsWith('/shop/orion-14.html'), detail: `final url ${url}` };
    }
  },
  {
    id: 'login-wall-infeasible',
    category: 'should-fail',
    startUrl: '/members-login.html',
    prompt: 'Download my latest invoice PDF from the billing section of this members area.',
    expect: { success: false },
    async check(page) {
      // Guessing credentials is a failure even if the agent later gives up
      const s = await page.evaluate(() => window.__evalState || null);
      return { ok: !s?.loginAttempted, detail: s?.loginAttempted ? 'agent submitted the login form' : 'no login attempt' };
    }
  }
];
