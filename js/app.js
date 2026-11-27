import { Translator } from './i18n.js';
import { FortalOpsAPI } from './api.js';
import { DashboardUI } from './ui.js';

const SUPABASE_URL = 'https://jbyyzztewzrurqreouqs.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_4gsx3jcA6WqTPJPsRUuQsg_mgrAuINP';
const PIX_KEY_DISPLAY = '02874149900';
const WG_SERVER_PUBLIC_KEY = '6ddQiL+B2KKGyyvagP0Hl0p+cxg4kBYWJ36QVQeRK0o=';
const WG_SERVER_ENDPOINT = '201.23.90.205:51820';

class FortalOpsApp {
  constructor() {
    this.translator = new Translator();
    this.api = new FortalOpsAPI(SUPABASE_URL, SUPABASE_ANON_KEY);
    this.ui = new DashboardUI(this.translator, PIX_KEY_DISPLAY);

    this.currentCycle = 'monthly';
    this.cachedPlans = [];
    this.cachedUserSubs = [];
    this.currentUser = null;
    this.currentProfile = null;
    this.authMode = 'signup';
    this.pendingCheckout = null;
  }

  getSupabaseClient() {
    return this.api.supabase || this.api.client || window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
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
    document.getElementById('langSelector').addEventListener('change', async (e) => {
      this.translator.setLanguage(e.target.value);
      this.ui.renderPlans(this.cachedPlans, this.currentCycle);
      if (this.currentUser) {
        this.cachedUserSubs = await this.api.fetchUserSubscriptions(this.currentUser.id);
        this.ui.renderUserSubscriptions(this.cachedUserSubs);
        const payments = await this.api.fetchUserPayments(this.currentUser.id);
        this.ui.renderUserPayments(payments);
        await this.loadUserPeers();
      }
    });

    document.querySelectorAll('.toggle-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.currentCycle = btn.dataset.cycle;
        document.querySelectorAll('.toggle-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.ui.renderPlans(this.cachedPlans, this.currentCycle);
      });
    });

    document.addEventListener('click', async (e) => {
      const subBtn = e.target.closest('[data-subscribe-plan]');
      if (subBtn) {
        await this.startCheckout(subBtn.dataset.subscribePlan, subBtn.dataset.provider);
        return;
      }

      const openUpgBtn = e.target.closest('[data-open-upgrade]');
      if (openUpgBtn) {
        const sub = this.cachedUserSubs.find((s) => s.id === openUpgBtn.dataset.openUpgrade);
        const targetPlan = this.cachedPlans.find((p) => p.slug === 'vpn-desempenho' && p.active);
        if (sub && targetPlan) {
          this.ui.openUpgradeModal(sub, targetPlan);
        }
        return;
      }

      const confirmUpgBtn = e.target.closest('[data-confirm-upgrade]');
      if (confirmUpgBtn) {
        const subId = confirmUpgBtn.dataset.confirmUpgrade;
        const targetPlanId = confirmUpgBtn.dataset.targetPlan;
        const provider = confirmUpgBtn.dataset.provider;
        const prorata = parseFloat(confirmUpgBtn.dataset.prorata);
        const sub = this.cachedUserSubs.find((s) => s.id === subId);

        try {
          const checkoutUrl = await this.api.createCheckoutSession({
            planId: targetPlanId,
            billingCycle: sub?.billing_cycle || 'monthly',
            provider,
            upgradeSubscriptionId: subId,
            prorataAmount: prorata
          });
          window.location.href = checkoutUrl;
        } catch (err) {
          alert(err.message);
        }
        return;
      }

      if (e.target.closest('[data-close-upgrade]')) {
        this.ui.closeUpgradeModal();
        return;
      }

      const cancelSubBtn = e.target.closest('[data-cancel-sub]');
      if (cancelSubBtn) {
        const isRefund = cancelSubBtn.dataset.refund7d === 'true';
        const msg = this.translator.t(isRefund ? 'confirm_refund' : 'confirm_cancel');
        if (confirm(msg)) {
          try {
            await this.api.cancelSubscription(cancelSubBtn.dataset.cancelSub, isRefund);
            alert(this.translator.t('cancel_success'));
            await this.refreshSession();
          } catch (err) {
            alert('Erro: ' + err.message);
          }
        }
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

      if (e.target.id === 'btnProvisionVpn') {
        await this.handleProvisionVpn();
        return;
      }

      const revokePeerBtn = e.target.closest('[data-revoke-peer]');
      if (revokePeerBtn) {
        await this.handleRevokePeer(revokePeerBtn.dataset.revokePeer);
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

    document.getElementById('authForm').addEventListener('submit', (e) => this.handleAuthSubmit(e));
    document.getElementById('newPlanForm').addEventListener('submit', (e) => this.handleCreatePlan(e));
  }

  async loadPlans() {
    try {
      this.cachedPlans = await this.api.fetchPlans();
      this.ui.renderPlans(this.cachedPlans, this.currentCycle);
      if (this.currentProfile?.role === 'admin') {
        this.ui.renderAdminPlans(this.cachedPlans);
      }
    }
