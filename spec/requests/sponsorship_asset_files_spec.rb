# frozen_string_literal: true

require 'rails_helper'

RSpec.describe 'Sponsorship asset files', type: :request do
  let(:conference) { FactoryBot.create(:conference, :full) }
  let(:sponsorship) { FactoryBot.create(:sponsorship, conference:, plan: conference.plans.first) }
  let(:asset_file) { sponsorship.asset_file }
  let(:presigner) { instance_double(Aws::S3::Presigner, presigned_url: 'https://s3.example.com/logo.png') }

  before do
    client = instance_double(Aws::S3::Client)
    allow(Aws::S3::Client).to receive(:new).and_return(client)
    allow(Aws::S3::Presigner).to receive(:new).with(client:).and_return(presigner)
    token = FactoryBot.create(:session_token, email: sponsorship.contact.email)
    get claim_user_session_path(token.handle)
  end

  [nil, 'inline', 'unexpected'].each do |disposition|
    it "serves #{disposition.inspect} with an allowed disposition" do
      get user_conference_sponsorship_asset_file_path(conference, asset_file), params: {disposition:}

      expect(response).to redirect_to('https://s3.example.com/logo.png')
      expected = disposition == 'inline' ? 'inline' : 'attachment'
      expect(presigner).to have_received(:presigned_url).with(
        :get_object,
        hash_including(response_content_disposition: a_string_starting_with("#{expected};")),
      )
    end
  end

  it 'does not expose another sponsor logo through the preview endpoint' do
    other = FactoryBot.create(:sponsorship, conference:, plan: conference.plans.first)
    get user_conference_sponsorship_asset_file_path(conference, other.asset_file), params: {disposition: 'inline'}

    expect(response).to have_http_status(:not_found)
    expect(presigner).not_to have_received(:presigned_url)
  end
end
