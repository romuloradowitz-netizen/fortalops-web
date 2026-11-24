import { Translator } from './i18n.js';
import { FortalOpsAPI } from './api.js';
import { DashboardUI } from './ui.js';

const SUPABASE_URL = 'https://jbyyzztewzrurqreouqs.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_4gsx3jcA6WqTPJPsRUuQsg_mgrAuINP';
const PIX_KEY_DISPLAY = '02874149900';

class FortalOpsApp {
  constructor() {
    this.translator = new Translator();
    this.api = new FortalOpsAPI(SUPABASE_URL, SUPABASE_ANON_KEY);
    this.ui = new DashboardUI(this.translator, PIX_KEY_DISPLAY);

    this.currentCycle = 'monthly';
    this.cachedPlans = [];
    this.currentUser = null;
    this.currentProfile = null;
    this.authMode = 'signup';
    this.pendingCheckout = null;
  }

  async init() {
    const langSelect = document.getElementById('langSelector');
    langSelect.value = this.translator.lang;
    this.translator.applyToDOM();

    this.bindEvents();
    await this.loadPlans();
    await this.refreshSession();
    await this.handlePaymentReturnParams();
  }

  bindEvents() {
    // Seletor de idiomas
    document.getElementById('langSelector').addEventListener('change', async (e) => {
      this.translator.setLanguage(e.target.value);
      this.ui.renderPlans(this.cachedPlans, this.currentCycle);
      if (this.currentUser) {
        const subs = await this.api.fetchUserSubscriptions(this.currentUser.id);
        this.ui.renderUserSubscriptions(subs);
      }
    });

    // Ciclos de cobrança
    document.querySelectorAll('.toggle-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.currentCycle = btn.dataset.cycle;
        document.querySelectorAll('.toggle-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.ui.renderPlans(this.cachedPlans, this.currentCycle);
      });
    });

    // Delegação global de cliques
    document.addEventListener('click', async (e) => {
      const subBtn = e.target.closest('[data-subscribe-plan]');
      if (subBtn) {
        await this.startCheckout(subBtn.dataset.subscribePlan, subBtn.dataset.provider);
        return;
      }

      const authBtn = e.target.closest('[data-open-auth]');
      if (authBtn) {
        this.authMode = authBtn.dataset.openAuth;
        this.ui.openAuthModal(this.authMode);
        return;
      }

      if (e.target.closest('[data-close-auth]')) {
        this.ui.closeAuthModal();
        return;
      }

      if (e.target.closest('[data-open-contract]')) {
        e.preventDefault();
        this.ui.openContractModal();
        return;
      }

      if (e.target.closest('[data-close-contract]')) {
        this.ui.closeContractModal();
        return;
      }

      if (e.target.id === 'btnLogout') {
        await this.logout();
        return;
      }

      if (e.target.id === 'btnToggleNewPlan') {
        const form = document.getElementById('newPlanForm');
        form.style.display = form.style.display === 'none' ? 'block' : 'none';
        return;
      }

      const copyPixBtn = e.target.closest('[data-copy-pix]');
      if (copyPixBtn) {
        await navigator.clipboard.writeText(copyPixBtn.dataset.copyPix);
        alert('Pix copiado!');
        return;
      }

      const togglePlanBtn = e.target.closest('[data-toggle-plan]');
      if (togglePlanBtn) {
        const isActive = togglePlanBtn.dataset.planActive === 'true';
        await this.api.togglePlanStatus(togglePlanBtn.dataset.togglePlan, isActive);
        await this.loadPlans();
        return;
      }

      const approveBtn = e.target.closest('[data-approve-sub]');
      if (approveBtn) {
        await this.api.approveSubscription(approveBtn.dataset.approveSub);
        await this.refreshSession();
      }
    });

    // Formulário de Login / Cadastro
    document.getElementById('authForm').addEventListener('submit', (e) => this.handleAuthSubmit(e));

    // Formulário Admin de Novo Plano
    document.getElementById('newPlanForm').addEventListener('submit', (e) => this.handleCreatePlan(e));
  }

  async loadPlans() {
    try {
      this.cachedPlans = await this.api.fetchPlans();
      this.ui.renderPlans(this.cachedPlans, this.currentCycle);
      if (this.currentProfile?.role === 'admin') {
        this.ui.renderAdminPlans(this.cachedPlans);
      }
    } catch (err) {
      document.getElementById('dynamicPlansGrid').innerHTML =
        `<p style="color:var(--danger);text-align:center;grid-column:1/-1;">Erro: ${err.message}</p>`;
    }
  }

  async startCheckout(planId, provider) {
    if (!this.currentUser) {
      this.pendingCheckout = { planId, provider };
      this.authMode = 'signup';
      this.ui.openAuthModal('signup');
      return;
    }

    try {
      const checkoutUrl = await this.api.createCheckoutSession({
        planId,
        billingCycle: this.currentCycle,
        provider
      });
      this.pendingCheckout = null;
      window.location.href = checkoutUrl;
    } catch (err) {
      alert(err.message);
    }
  }

  async handleAuthSubmit(e) {
    e.preventDefault();
    const email = document.getElementById('userEmail').value.trim();
    const password = document.getElementById('userPass').value;
    const fullName = document.getElementById('userName').value.trim();
    const fb = document.getElementById('authFeedback');

    fb.style.color = 'var(--primary)';
    fb.innerText = '...';

    if (this.authMode === 'signup') {
      const { error } = await this.api.signUp({
        email,
        password,
        fullName,
        preferredLang: this.translator.lang
      });
      if (error) {
        fb.style.color = 'var(--danger)';
        fb.innerText = error.message;
        return;
      }
      fb.style.color = 'var(--accent)';
      fb.innerText = '✓ OK!';
      setTimeout(async () => {
        this.ui.closeAuthModal();
        await this.refreshSession();
        if (this.pendingCheckout) {
          await this.startCheckout(this.pendingCheckout.planId, this.pendingCheckout.provider);
        }
      }, 800);
    } else {
      const { error } = await this.api.signIn({ email, password });
      if (error) {
        fb.style.color = 'var(--danger)';
        fb.innerText = error.message;
        return;
      }
      this.ui.closeAuthModal();
      await this.refreshSession();
    }
  }

  async logout() {
    await this.api.signOut();
    this.currentUser = null;
    this.currentProfile = null;
    document.getElementById('guestActions').style.display = 'flex';
    document.getElementById('userActions').style.display = 'none';
    document.getElementById('dashboardSection').style.display = 'none';
  }

  async refreshSession() {
    const session = await this.api.getSession();
    if (!session) return;

    this.currentUser = session.user;
    this.currentProfile = await this.api.getProfile(this.currentUser.id);

    document.getElementById('guestActions').style.display = 'none';
    document.getElementById('userActions').style.display = 'flex';
    document.getElementById('dashboardSection').style.display = 'block';

    document.getElementById('dashWelcome').innerText = this.currentProfile?.full_name || this.currentUser.email;
    document.getElementById('dashEmail').innerText = this.currentUser.email;

    const badge = document.getElementById('dashRoleBadge');
    if (this.currentProfile?.role === 'admin') {
      badge.innerText = 'ADMIN';
      badge.classList.add('admin');
      document.getElementById('adminPanel').style.display = 'block';
      this.ui.renderAdminPlans(this.cachedPlans);
      const allSubs = await this.api.fetchAllSubscriptions();
      this.ui.renderAdminSubscriptions(allSubs);
    } else {
      badge.innerText = 'VIP';
      badge.classList.remove('admin');
      document.getElementById('adminPanel').style.display = 'none';
    }

    const userSubs = await this.api.fetchUserSubscriptions(this.currentUser.id);
    this.ui.renderUserSubscriptions(userSubs);
  }

  async handleCreatePlan(e) {
    e.preventDefault();
    const slug = document.getElementById('pSlug').value.trim();
    const namePt = document.getElementById('pNamePt').value.trim();
    const nameEn = document.getElementById('pNameEn').value.trim();
    const priceBrl = parseFloat(document.getElementById('pPriceBrl').value);
    const priceUsd = parseFloat(document.getElementById('pPriceUsd').value);
    const maxDevices = parseInt(document.getElementById('pDevices').value, 10);
    const featPt = document.getElementById('pFeatPt').value.split('\n').map((s) => s.trim()).filter(Boolean);
    const featEn = document.getElementById('pFeatEn').value.split('\n').map((s) => s.trim()).filter(Boolean);

    try {
      await this.api.createPlan({
        slug,
        names: { pt: namePt, en: nameEn, it: nameEn, de: nameEn, fr: nameEn },
        features: { pt: featPt, en: featEn, it: featEn, de: featEn, fr: featEn },
        price_brl_monthly: priceBrl,
        price_usd_monthly: priceUsd,
        max_devices: maxDevices,
        sort_order: this.cachedPlans.length + 1
      });
      e.target.reset();
      document.getElementById('newPlanForm').style.display = 'none';
      await this.loadPlans();
    } catch (err) {
      alert('Erro ao salvar plano: ' + err.message);
    }
  }

  async handlePaymentReturnParams() {
    const params = new URLSearchParams(window.location.search);
    const payStatus = params.get('payment');
    if (!payStatus) return;

    if (payStatus === 'success') {
      alert(this.translator.t('pay_success_msg'));
      window.history.replaceState({}, document.title, window.location.pathname);
      if (this.currentUser) {
        const subs = await this.api.fetchUserSubscriptions(this.currentUser.id);
        this.ui.renderUserSubscriptions(subs);
      }
    } else if (payStatus === 'failure') {
      alert(this.translator.t('pay_fail_msg'));
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }
}

const app = new FortalOpsApp();
app.init();
