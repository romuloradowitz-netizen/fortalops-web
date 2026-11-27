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
    this.cachedUserSubs = [];
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

    this.cachedUserSubs = await this.api.fetchUserSubscriptions(this.currentUser.id);
    this.ui.renderUserSubscriptions(this.cachedUserSubs);

    const userPayments = await this.api.fetchUserPayments(this.currentUser.id);
    this.ui.renderUserPayments(userPayments);

    await this.loadUserPeers();
  }

  // --- Gestão de Dispositivos WireGuard (Cliente Self-Provisioning) ---

  uint8ToBase64(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  async loadUserPeers() {
    const container = document.getElementById('clientPeersList');
    if (!container || !this.currentUser) return;

    try {
      const sb = this.getSupabaseClient();
      const { data: peers, error } = await sb
        .from('vpn_peers')
        .select('id, device_name, public_key, assigned_ip, active, created_at')
        .eq('user_id', this.currentUser.id)
        .eq('active', true)
        .order('created_at', { ascending: false });

      if (error) throw error;

      if (!peers || peers.length === 0) {
        container.innerHTML = `<p style="color: var(--muted);">Nenhum dispositivo ativo ainda. Digite um nome acima e clique em <strong>+ Gerar & Baixar .conf</strong>.</p>`;
        return;
      }

      container.innerHTML = `
        <div style="overflow-x: auto;">
          <table>
            <thead>
              <tr>
                <th>Dispositivo</th>
                <th>IP Interno</th>
                <th>Chave Pública</th>
                <th>Status</th>
                <th>Ação</th>
              </tr>
            </thead>
            <tbody>
              ${peers.map((p) => `
                <tr>
                  <td><strong>${p.device_name}</strong></td>
                  <td><code>${p.assigned_ip}</code></td>
                  <td><code title="${p.public_key}">${p.public_key.slice(0, 14)}...</code></td>
                  <td><span style="color: var(--accent); font-weight: 600;">● Ativo</span></td>
                  <td>
                    <button class="btn btn-ghost btn-sm" style="color: var(--danger); border-color: var(--danger);" data-revoke-peer="${p.id}">
                      Revogar
                    </button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    } catch (err) {
      container.innerHTML = `<p style="color: var(--danger);">Erro ao carregar dispositivos: ${err.message}</p>`;
    }
  }

  async handleProvisionVpn() {
    if (!this.currentUser) {
      alert('Faça login primeiro para gerar sua configuração VPN.');
      return;
    }

    const hasActiveSub = this.cachedUserSubs.some((s) => s.status === 'active');
    const isAdmin = this.currentProfile?.role === 'admin';
    if (!hasActiveSub && !isAdmin) {
      alert('Você precisa de uma assinatura ativa para gerar chaves VPN.');
      return;
    }

    const btn = document.getElementById('btnProvisionVpn');
    const nameInput = document.getElementById('newDeviceName');
    const deviceName = (nameInput?.value || '').trim() || 'Meu Dispositivo';

    if (!window.nacl) {
      alert('Biblioteca de criptografia ainda carregando. Tente novamente em 1 segundo.');
      return;
    }

    const originalLabel = btn.innerText;
    btn.disabled = true;
    btn.innerText = 'Gerando chaves...';

    try {
      // 1. Gera o par de chaves Curve25519 localmente no browser
      const keyPair = window.nacl.box.keyPair();
      const privateKeyBase64 = this.uint8ToBase64(keyPair.secretKey);
      const publicKeyBase64 = this.uint8ToBase64(keyPair.publicKey);

      // 2. Reserva IP livre e grava a chave pública no Supabase via RPC
      const sb = this.getSupabaseClient();
      const { data, error } = await sb.rpc('provision_vpn_peer', {
        p_device_name: deviceName,
        p_public_key: publicKeyBase64
      });

      if (error) throw error;
      const assignedIp = data[0].assigned_ip;

      // 3. Monta o ficheiro .conf pronto para importar no WireGuard
      const configContent = `[Interface]
PrivateKey = ${privateKeyBase64}
Address = ${assignedIp}
DNS = 1.1.1.1, 1.0.0.1

[Peer]
PublicKey = ${WG_SERVER_PUBLIC_KEY}
Endpoint = ${WG_SERVER_ENDPOINT}
AllowedIPs = 0.0.0.0/0, ::/0
PersistentKeepalive = 25
`;

      // 4. Faz o download automático do arquivo .conf
      const safeFileName = deviceName.toLowerCase().replace(/[^a-z0-9-_]/g, '-') || 'fortalops';
      const blob = new Blob([configContent], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `fortalops-${safeFileName}.conf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      if (nameInput) nameInput.value = '';
      await this.loadUserPeers();
      alert(`Configuração gerada com sucesso (IP ${assignedIp})! O túnel será liberado automaticamente em até 10 segundos.`);
    } catch (err) {
      alert('Erro ao gerar configuração VPN: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.innerText = originalLabel;
    }
  }

  async handleRevokePeer(peerId) {
    if (!confirm('Deseja revogar este dispositivo? Ele perderá o acesso à VPN em até 10 segundos.')) {
      return;
    }

    try {
      const sb = this.getSupabaseClient();
      const { error } = await sb
        .from('vpn_peers')
        .update({ active: false })
        .eq('id', peerId)
        .eq('user_id', this.currentUser.id);

      if (error) throw error;
      await this.loadUserPeers();
    } catch (err) {
      alert('Erro ao revogar dispositivo: ' + err.message);
    }
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
        await this.refreshSession();
      }
    } else if (payStatus === 'failure') {
      alert(this.translator.t('pay_fail_msg'));
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }
}

const app = new FortalOpsApp();
app.init();
