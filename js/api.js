export class FortalOpsAPI {
  constructor(supabaseUrl, supabaseAnonKey) {
    this.sb = window.supabase.createClient(supabaseUrl, supabaseAnonKey);
  }

  async getSession() {
    const { data: { session } } = await this.sb.auth.getSession();
    return session;
  }

  async getProfile(userId) {
    const { data } = await this.sb.from('profiles').select('*').eq('id', userId).single();
    return data;
  }

  async signUp({ email, password, fullName, preferredLang }) {
    return this.sb.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          preferred_lang: preferredLang,
          accepted_terms_at: new Date().toISOString()
        }
      }
    });
  }

  async signIn({ email, password }) {
    return this.sb.auth.signInWithPassword({ email, password });
  }

  async signOut() {
    return this.sb.auth.signOut();
  }

  async fetchPlans() {
    const { data, error } = await this.sb
      .from('plans')
      .select('*')
      .order('sort_order', { ascending: true });
    if (error) throw error;
    return data || [];
  }

  async fetchUserSubscriptions(userId) {
    const { data } = await this.sb
      .from('subscriptions')
      .select('*, plans(id, slug, names, price_brl_monthly, price_usd_monthly, discount_annual_pct, discount_biennial_pct, max_devices)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    return data || [];
  }

  async fetchUserPayments(userId) {
    const { data } = await this.sb
      .from('payments')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    return data || [];
  }

  async cancelSubscription(subId, isRefundWithin7Days) {
    const { error } = await this.sb
      .from('subscriptions')
      .update({
        status: isRefundWithin7Days ? 'refund_requested' : 'canceled',
        canceled_at: new Date().toISOString(),
        cancel_reason: isRefundWithin7Days ? '7_day_guarantee' : 'user_canceled'
      })
      .eq('id', subId);
    if (error) throw error;
  }

  async createCheckoutSession({ planId, billingCycle, provider, upgradeSubscriptionId = null, prorataAmount = null }) {
    const fnName = provider === 'paypal' ? 'create-paypal-checkout' : 'create-mp-checkout';
    const { data, error } = await this.sb.functions.invoke(fnName, {
      body: {
        plan_id: planId,
        billing_cycle: billingCycle,
        upgrade_subscription_id: upgradeSubscriptionId,
        prorata_amount: prorataAmount
      }
    });
    if (error || !data?.checkout_url) {
      throw new Error(error?.message || data?.error || 'Erro ao iniciar checkout.');
    }
    return data.checkout_url;
  }

  // Admin methods
  async createPlan(planPayload) {
    const { error } = await this.sb.from('plans').insert(planPayload);
    if (error) throw error;
  }

  async togglePlanStatus(planId, currentStatus) {
    const { error } = await this.sb.from('plans').update({ active: !currentStatus }).eq('id', planId);
    if (error) throw error;
  }

  async fetchAllSubscriptions() {
    const { data } = await this.sb
      .from('subscriptions')
      .select('*, profiles(email, full_name), plans(names)')
      .order('created_at', { ascending: false });
    return data || [];
  }

  async approveSubscription(subId) {
    const { error } = await this.sb
      .from('subscriptions')
      .update({ status: 'active', current_period_start: new Date().toISOString() })
      .eq('id', subId);
    if (error) throw error;
  }
}
