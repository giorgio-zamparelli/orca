require "minitest/autorun"

module SharedValues
  SIGH_NAME = :SIGH_NAME unless const_defined?(:SIGH_NAME)
end

class WatchReleaseLaneHarness
  attr_reader :profiles, :signing_settings, :build_options

  def initialize
    @lanes = {}
    @context = {}
    @profiles = []
    @signing_settings = []
    path = File.expand_path("Fastfile", __dir__)
    instance_eval(File.read(path), path)
    define_singleton_method(:app_store_connect_api_key_from_env) { :test_api_key }
  end

  def default_platform(*) end
  def platform(*) yield end
  def desc(*) end
  def lane(name, &block) @lanes[name] = block end
  def lane_context; @context end

  def get_provisioning_profile(**options)
    @profiles << options
    @context[SharedValues::SIGH_NAME] = "Profile #{options.fetch(:app_identifier)}"
  end

  def update_code_signing_settings(**options) @signing_settings << options end
  def build_app(**options) @build_options = options end
  def upload_to_testflight(*) end
  def build; @lanes.fetch(:build_and_upload).call end
end

class FastfileWatchSigningTest < Minitest::Test
  def test_each_app_uses_its_own_profile_at_archive_and_export
    previous = ENV["APPLE_TEAM_ID"]
    ENV["APPLE_TEAM_ID"] = "TESTTEAM"
    harness = WatchReleaseLaneHarness.new
    harness.build
    assert_equal(["com.stably.orca.mobile", "com.stably.orca.mobile.watch"],
      harness.profiles.map { |options| options.fetch(:app_identifier) })
    assert_equal(["Orca", "OrcaWatch"], harness.signing_settings.flat_map { |options| options.fetch(:targets) })
    harness.signing_settings.each do |options|
      assert_equal(["Release"], options.fetch(:build_configurations))
      assert_equal(false, options.fetch(:use_automatic_signing))
      assert_equal("TESTTEAM", options.fetch(:team_id))
    end
    assert_equal("Profile com.stably.orca.mobile", harness.signing_settings[0].fetch(:profile_name))
    assert_equal("Profile com.stably.orca.mobile.watch", harness.signing_settings[1].fetch(:profile_name))
    assert_equal({
      "com.stably.orca.mobile" => "Profile com.stably.orca.mobile",
      "com.stably.orca.mobile.watch" => "Profile com.stably.orca.mobile.watch",
    }, harness.build_options.fetch(:export_options).fetch(:provisioningProfiles))
    refute_includes(harness.build_options.fetch(:xcargs), "PROVISIONING_PROFILE_SPECIFIER")
  ensure
    ENV["APPLE_TEAM_ID"] = previous
  end
end
