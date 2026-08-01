const { withAppDelegate, withInfoPlist } = require('@expo/config-plugins');

// iOS 27 terminates apps that don't adopt the UIScene lifecycle ("UIScene
// life cycle is required for apps built with this SDK"). Expo SDK 57 /
// RN 0.86 still generate the app-delegate lifecycle, so until upstream
// adopts scenes this plugin does the minimal adoption itself: a scene
// manifest in Info.plist plus a SceneDelegate that creates the window and
// starts React Native there instead of in didFinishLaunching. Remove once
// Expo ships native UIScene support.
module.exports = function withSceneLifecycle(config) {
  config = withInfoPlist(config, (cfg) => {
    cfg.modResults['UIApplicationSceneManifest'] = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: 'Default Configuration',
            UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).SceneDelegate',
          },
        ],
      },
    };
    return cfg;
  });

  config = withAppDelegate(config, (cfg) => {
    let src = cfg.modResults.contents;
    if (src.includes('class SceneDelegate')) return cfg; // already applied

    src = src.replace(
      '  var window: UIWindow?',
      '  var window: UIWindow?\n  var launchOptions: [UIApplication.LaunchOptionsKey: Any]?',
    );

    src = src.replace(
      /#if os\(iOS\) \|\| os\(tvOS\)\n    window = UIWindow\(frame: UIScreen\.main\.bounds\)\n    factory\.startReactNative\(\n      withModuleName: "main",\n      in: window,\n      launchOptions: launchOptions\)\n#endif/,
      '    // UIScene lifecycle (iOS 27 requirement): the window is created and\n' +
        '    // React Native started in SceneDelegate.scene(_:willConnectTo:).\n' +
        '    self.launchOptions = launchOptions',
    );

    src += `
class SceneDelegate: NSObject, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene,
          let appDelegate = UIApplication.shared.delegate as? AppDelegate,
          let factory = appDelegate.reactNativeFactory
    else { return }
    let window = UIWindow(windowScene: windowScene)
    self.window = window
    appDelegate.window = window
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: appDelegate.launchOptions)
  }
}
`;
    cfg.modResults.contents = src;
    return cfg;
  });

  return config;
};
