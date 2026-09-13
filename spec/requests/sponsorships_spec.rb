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

  describe 'updating sponsor information' do
    let(:sponsorship) { FactoryBot.create(:sponsorship, conference:, plan: conference.plans.first) }

    before do
      allow(ProcessSponsorshipEditJob).to receive(:perform_later)
      token = FactoryBot.create(:session_token, email: sponsorship.contact.email)
      get claim_user_session_path(token.handle)
    end

    it 'does not save an update without logo confirmation' do
      original_name = sponsorship.name
      patch user_conference_sponsorship_path(conference), params: {sponsorship: {name: 'Updated name'}}

      expect(response).to have_http_status(:ok)
      expect(sponsorship.reload.name).to eq(original_name)
      confirmation = response.parsed_body.at_css('input[type="checkbox"][name="sponsorship[logo_confirmation]"]')
      expect(confirmation['checked']).to be_nil
      expect(response.parsed_body.at_css('.alert-danger').text).to include(Sponsorship.human_attribute_name(:logo_confirmation))
    end

    it 'saves an update when logo confirmation is submitted' do
      patch user_conference_sponsorship_path(conference), params: {sponsorship: {name: 'Updated name', logo_confirmation: '1'}}

      expect(response).to redirect_to(user_conference_sponsorship_path(conference, conference:))
      expect(sponsorship.reload.name).to eq('Updated name')
      expect(ProcessSponsorshipEditJob).to have_received(:perform_later)
    end

    it 'rejects non-Latin information even with logo confirmation' do
      original_name = sponsorship.name
      original_profile = sponsorship.profile
      patch user_conference_sponsorship_path(conference), params: {sponsorship: {name: '株式会社Example', profile: '紹介文', logo_confirmation: '1'}}

      expect(response).to have_http_status(:ok)
      expect(sponsorship.reload.name).to eq(original_name)
      expect(sponsorship.profile).to eq(original_profile)
      errors = response.parsed_body.at_css('.alert-danger').text
      expect(errors).to include(Sponsorship.human_attribute_name(:name), Sponsorship.human_attribute_name(:profile))
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
