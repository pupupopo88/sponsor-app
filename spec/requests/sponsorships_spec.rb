# frozen_string_literal: true

require 'rails_helper'

RSpec.describe 'Sponsorships', type: :request do
  let(:conference) { FactoryBot.create(:conference, :full, hidden: false, application_opens_at: 1.day.ago) }

  describe 'booth choice' do
    it 'starts a new application without a choice' do
      get new_user_conference_sponsorship_path(conference)
      expect(response.parsed_body.css('input[name="sponsorship[booth_requested]"][checked]')).to be_empty
    end

    [nil, 'true', 'false'].each do |choice|
      it "preserves #{choice.inspect} after a failed submission" do
        plan = conference.plans.first
        plan.update!(booth_size: 1)
        attributes = {plan_id: plan.id, contact_attributes: FactoryBot.attributes_for(:contact)}
        attributes[:booth_requested] = choice unless choice.nil?
        post user_conference_sponsorship_path(conference), params: {sponsorship: attributes}

        expect(response).to have_http_status(:ok)
        checked = response.parsed_body.css('input[name="sponsorship[booth_requested]"][checked]')
        expect(checked.map { |input| input['value'] }).to eq(choice.nil? ? [] : [choice])
        if choice.nil?
          expect(response.body).to include(I18n.t('activerecord.errors.models.sponsorship.attributes.booth_requested.inclusion'))
        end
      end
    end
  end

  describe 'copying a previous application' do
    let(:previous_conference) { FactoryBot.create(:conference, :full) }
    let(:previous_sponsorship) { FactoryBot.create(:sponsorship, conference: previous_conference, plan: previous_conference.plans.first) }
    let(:session_token) { FactoryBot.create(:session_token, email: previous_sponsorship.contact.email) }

    before { get claim_user_session_path(session_token.handle) }

    it 'shows a success message only when the application was copied' do
      get new_user_conference_sponsorship_path(conference), params: {sponsorship_id_to_copy: previous_sponsorship.id}

      expect(response).to have_http_status(:ok)
      expect(response.body).to include(I18n.t('sponsorships.form.copy.applied'))
      expect(response.body).to include(previous_sponsorship.name)
    end

    it 'does not report success for an inaccessible application' do
      other_sponsorship = FactoryBot.create(:sponsorship, conference: previous_conference, plan: previous_conference.plans.first)
      get new_user_conference_sponsorship_path(conference), params: {sponsorship_id_to_copy: other_sponsorship.id}

      expect(response).to have_http_status(:ok)
      expect(response.body).not_to include(I18n.t('sponsorships.form.copy.applied'))
      expect(response.body).not_to include(other_sponsorship.name)
    end
  end
end
