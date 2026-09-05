# frozen_string_literal: true

require 'rails_helper'

RSpec.describe "Admin Invoices", type: :request do
  let(:conference) { FactoryBot.create(:conference) }
  let(:ruby_plan) { FactoryBot.create(:plan, conference:, name: 'Ruby', price: 300_000, price_text: '30万円') }
  let(:gold_plan) { FactoryBot.create(:plan, conference:, name: 'Gold', price: 200_000, price_text: '20万円') }
  let(:staff) { FactoryBot.create(:staff) }
  let(:session_token) { FactoryBot.create(:session_token, staff:) }
  let(:standard_ja_sponsorship) do
    FactoryBot.create(:sponsorship, conference:, plan: ruby_plan, locale: 'ja', accepted_at: Time.current)
  end
  let(:custom_en_sponsorship) do
    FactoryBot.create(:sponsorship, conference:, plan: ruby_plan, locale: 'en', customization: true, customization_name: 'Custom Ruby', accepted_at: Time.current)
  end
  let(:standard_en_sponsorship) do
    FactoryBot.create(:sponsorship, conference:, plan: gold_plan, locale: 'en', accepted_at: Time.current)
  end

  before do
    standard_ja_sponsorship
    custom_en_sponsorship
    standard_en_sponsorship
    get claim_user_session_path(session_token.handle)
  end

  it 'exports every sponsorship by default' do
    get conference_invoices_path(conference, format: :csv)

    expect(response).to have_http_status(:ok)
    expect(invoice_rows.size).to eq(3)
  end

  it 'selects all locales and plans without filtering by customization on the initial HTML view' do
    get conference_invoices_path(conference)

    expect(response).to have_http_status(:ok)
    assert_select 'input[type="checkbox"][name="locales[]"]', count: 2
    assert_select 'input[type="checkbox"][name="locales[]"][checked="checked"]', count: 2
    assert_select 'input[type="checkbox"][name="plan_ids[]"]', count: 2
    assert_select 'input[type="checkbox"][name="plan_ids[]"][checked="checked"]', count: 2
    assert_select 'input[type="radio"][name="customization_filter"]', count: 3
    assert_select 'input[type="radio"][name="customization_filter"][value="all"][checked="checked"]', count: 1
  end

  it 'provides a CSV export button that submits the current filters' do
    get conference_invoices_path(conference)

    expect(response).to have_http_status(:ok)
    assert_select 'button[type="submit"][formaction$="/invoices.csv"]', text: 'Export CSV', count: 1
  end

  it 'filters sponsorships by locale, plan, and customization' do
    get conference_invoices_path(conference, format: :csv), params: {
      filters: 1,
      locales: ['en'],
      plan_ids: [ruby_plan.id],
      customization_filter: 'with',
    }

    expect(response).to have_http_status(:ok)
    expect(invoice_rows.size).to eq(1)
  end

  it 'filters sponsorships without customization' do
    get conference_invoices_path(conference, format: :csv), params: {
      filters: 1,
      locales: %w[en ja],
      plan_ids: [ruby_plan.id, gold_plan.id],
      customization_filter: 'without',
    }

    expect(response).to have_http_status(:ok)
    expect(invoice_rows.size).to eq(2)
  end

  private def invoice_rows
    CSV.parse(response.body).select { |row| row[1] == '請求書' }
  end
end
