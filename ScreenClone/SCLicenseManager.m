#import "SCLicenseManager.h"
#import "SCLicensePublicKey.h"
#import "SCOverlayManager.h"
#import <CommonCrypto/CommonDigest.h>
#import <Security/Security.h>
#import <UIKit/UIKit.h>
#import <dlfcn.h>
#import <sys/sysctl.h>

static NSString * const SCClientVersion = @"1.0.0";
static NSString * const SCLicenseBaseURL = @"https://www.alphagoldhub.com/api/screenclone";
static NSString * const SCKeychainService = @"com.quanhandsome.screenclone.license.v1";

typedef CFTypeRef (*SCMGCopyAnswerFunction)(CFStringRef key);

@interface SCLicenseManager ()
@property (nonatomic, copy) NSString *deviceId;
@property (nonatomic, copy) NSString *username;
@property (nonatomic, copy) NSString *refreshToken;
@property (nonatomic, copy) NSString *entitlement;
@property (nonatomic, strong) NSDictionary *licensePayload;
@property (nonatomic, assign) BOOL requestInFlight;
@property (nonatomic, assign) BOOL started;
@end

@implementation SCLicenseManager

+ (instancetype)sharedManager {
    static SCLicenseManager *manager;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        manager = [SCLicenseManager new];
    });
    return manager;
}

- (void)start {
    if (self.started) return;
    self.started = YES;
    self.deviceId = [self createDeviceId];
    self.username = [self keychainStringForAccount:@"username"];
    self.refreshToken = [self keychainStringForAccount:@"refresh-token"];
    self.entitlement = [self keychainStringForAccount:@"entitlement"];
    [self validateStoredEntitlement];

    if (self.username.length && self.refreshToken.length) {
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 2 * NSEC_PER_SEC),
                       dispatch_get_main_queue(), ^{
            [self refreshSilently:YES completion:nil];
        });
    }
}

- (NSString *)createDeviceId {
    NSString *rawIdentifier = nil;
    void *handle = dlopen("/usr/lib/libMobileGestalt.dylib", RTLD_LAZY);
    SCMGCopyAnswerFunction copyAnswer = handle
        ? (SCMGCopyAnswerFunction)dlsym(handle, "MGCopyAnswer")
        : NULL;
    if (copyAnswer) {
        CFTypeRef value = copyAnswer(CFSTR("UniqueDeviceID"));
        if (value) {
            if (CFGetTypeID(value) == CFStringGetTypeID()) {
                rawIdentifier = [(__bridge NSString *)value copy];
            }
            CFRelease(value);
        }
    }
    if (handle) dlclose(handle);

    if (!rawIdentifier.length) {
        rawIdentifier = [self keychainStringForAccount:@"installation-id"];
        if (!rawIdentifier.length) {
            rawIdentifier = NSUUID.UUID.UUIDString;
            [self setKeychainString:rawIdentifier forAccount:@"installation-id"];
        }
    }
    return [self sha256:[@"ScreenClone:v1:" stringByAppendingString:rawIdentifier]];
}

- (NSString *)sha256:(NSString *)value {
    NSData *data = [value dataUsingEncoding:NSUTF8StringEncoding];
    unsigned char digest[CC_SHA256_DIGEST_LENGTH];
    CC_SHA256(data.bytes, (CC_LONG)data.length, digest);
    NSMutableString *result = [NSMutableString stringWithCapacity:CC_SHA256_DIGEST_LENGTH * 2];
    for (NSInteger index = 0; index < CC_SHA256_DIGEST_LENGTH; index++) {
        [result appendFormat:@"%02x", digest[index]];
    }
    return result;
}

- (NSString *)hardwareModel {
    size_t length = 0;
    sysctlbyname("hw.machine", NULL, &length, NULL, 0);
    if (!length) return UIDevice.currentDevice.model ?: @"iPhone";
    char *buffer = calloc(length, sizeof(char));
    if (!buffer) return UIDevice.currentDevice.model ?: @"iPhone";
    sysctlbyname("hw.machine", buffer, &length, NULL, 0);
    NSString *model = [NSString stringWithUTF8String:buffer];
    free(buffer);
    return model ?: @"iPhone";
}

- (NSMutableDictionary *)keychainQueryForAccount:(NSString *)account {
    return [@{
        (__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
        (__bridge id)kSecAttrService: SCKeychainService,
        (__bridge id)kSecAttrAccount: account
    } mutableCopy];
}

- (NSString *)keychainStringForAccount:(NSString *)account {
    NSMutableDictionary *query = [self keychainQueryForAccount:account];
    query[(__bridge id)kSecReturnData] = @YES;
    query[(__bridge id)kSecMatchLimit] = (__bridge id)kSecMatchLimitOne;
    CFTypeRef result = NULL;
    OSStatus status = SecItemCopyMatching((__bridge CFDictionaryRef)query, &result);
    if (status != errSecSuccess || !result) return nil;
    NSData *data = CFBridgingRelease(result);
    return [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
}

- (void)setKeychainString:(NSString *)value forAccount:(NSString *)account {
    NSMutableDictionary *query = [self keychainQueryForAccount:account];
    if (!value.length) {
        SecItemDelete((__bridge CFDictionaryRef)query);
        return;
    }

    NSData *data = [value dataUsingEncoding:NSUTF8StringEncoding];
    NSDictionary *attributes = @{ (__bridge id)kSecValueData: data };
    OSStatus status = SecItemUpdate((__bridge CFDictionaryRef)query,
                                    (__bridge CFDictionaryRef)attributes);
    if (status == errSecItemNotFound) {
        query[(__bridge id)kSecValueData] = data;
        query[(__bridge id)kSecAttrAccessible] = (__bridge id)kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly;
        SecItemAdd((__bridge CFDictionaryRef)query, NULL);
    }
}

- (NSData *)base64URLData:(NSString *)value {
    if (!value.length) return nil;
    NSString *base64 = [[value stringByReplacingOccurrencesOfString:@"-" withString:@"+"]
                        stringByReplacingOccurrencesOfString:@"_" withString:@"/"];
    NSUInteger remainder = base64.length % 4;
    if (remainder) {
        base64 = [base64 stringByPaddingToLength:base64.length + (4 - remainder)
                                      withString:@"="
                                 startingAtIndex:0];
    }
    return [[NSData alloc] initWithBase64EncodedString:base64 options:0];
}

- (NSInteger)compareVersion:(NSString *)left to:(NSString *)right {
    NSArray<NSString *> *(^parts)(NSString *) = ^NSArray<NSString *> *(NSString *value) {
        NSString *core = [[value componentsSeparatedByCharactersInSet:
                           [NSCharacterSet characterSetWithCharactersInString:@"-+"]] firstObject];
        return [core componentsSeparatedByString:@"."];
    };
    NSArray<NSString *> *a = parts(left ?: @"0.0.0");
    NSArray<NSString *> *b = parts(right ?: @"0.0.0");
    for (NSInteger index = 0; index < 3; index++) {
        NSInteger av = index < (NSInteger)a.count ? a[index].integerValue : 0;
        NSInteger bv = index < (NSInteger)b.count ? b[index].integerValue : 0;
        if (av > bv) return NSOrderedDescending;
        if (av < bv) return NSOrderedAscending;
    }
    return NSOrderedSame;
}

- (NSTimeInterval)trustedCurrentTime {
    NSTimeInterval wallTime = NSDate.date.timeIntervalSince1970;
    NSTimeInterval anchorServer = [[self keychainStringForAccount:@"anchor-server-time"] doubleValue];
    NSTimeInterval anchorUptime = [[self keychainStringForAccount:@"anchor-uptime"] doubleValue];
    NSTimeInterval currentUptime = NSProcessInfo.processInfo.systemUptime;
    NSTimeInterval monotonicEstimate = anchorServer;
    if (anchorServer > 0 && currentUptime >= anchorUptime) {
        monotonicEstimate += currentUptime - anchorUptime;
    }
    return MAX(wallTime, monotonicEstimate);
}

- (NSDictionary *)verifiedPayloadForToken:(NSString *)token expectedNonce:(NSString *)expectedNonce {
    NSArray<NSString *> *segments = [token componentsSeparatedByString:@"."];
    if (segments.count != 2) return nil;

    NSData *publicData = [[NSData alloc] initWithBase64EncodedString:SCLicensePublicKeyX963Base64 options:0];
    NSData *signature = [self base64URLData:segments[1]];
    NSData *signedData = [segments[0] dataUsingEncoding:NSASCIIStringEncoding];
    if (publicData.length != 65 || !signature.length || !signedData.length) return nil;

    NSDictionary *attributes = @{
        (__bridge id)kSecAttrKeyType: (__bridge id)kSecAttrKeyTypeECSECPrimeRandom,
        (__bridge id)kSecAttrKeyClass: (__bridge id)kSecAttrKeyClassPublic,
        (__bridge id)kSecAttrKeySizeInBits: @256
    };
    CFErrorRef keyError = NULL;
    SecKeyRef publicKey = SecKeyCreateWithData((__bridge CFDataRef)publicData,
                                               (__bridge CFDictionaryRef)attributes,
                                               &keyError);
    if (keyError) CFRelease(keyError);
    if (!publicKey) return nil;

    BOOL supported = SecKeyIsAlgorithmSupported(publicKey,
                                                kSecKeyOperationTypeVerify,
                                                kSecKeyAlgorithmECDSASignatureMessageX962SHA256);
    CFErrorRef verifyError = NULL;
    BOOL validSignature = supported && SecKeyVerifySignature(
        publicKey,
        kSecKeyAlgorithmECDSASignatureMessageX962SHA256,
        (__bridge CFDataRef)signedData,
        (__bridge CFDataRef)signature,
        &verifyError);
    if (verifyError) CFRelease(verifyError);
    CFRelease(publicKey);
    if (!validSignature) return nil;

    NSData *payloadData = [self base64URLData:segments[0]];
    NSDictionary *payload = payloadData
        ? [NSJSONSerialization JSONObjectWithData:payloadData options:0 error:nil]
        : nil;
    if (![payload isKindOfClass:NSDictionary.class]) return nil;
    if (![payload[@"typ"] isEqualToString:@"screenclone-license"] ||
        [payload[@"v"] integerValue] != 1 ||
        ![payload[@"did"] isEqualToString:self.deviceId] ||
        ![[payload[@"sub"] lowercaseString] isEqualToString:self.username.lowercaseString]) {
        return nil;
    }
    if (expectedNonce.length && ![payload[@"nonce"] isEqualToString:expectedNonce]) return nil;
    if ([self compareVersion:SCClientVersion to:payload[@"min"]] == NSOrderedAscending) return nil;

    NSTimeInterval issuedAt = [payload[@"iat"] doubleValue];
    NSTimeInterval notBefore = [payload[@"nbf"] doubleValue];
    NSTimeInterval expiresAt = [payload[@"exp"] doubleValue];
    NSTimeInterval now = expectedNonce.length ? issuedAt : [self trustedCurrentTime];
    if (issuedAt <= 0 || notBefore > now + 60 || expiresAt <= now ||
        expiresAt - issuedAt > 24 * 60 * 60 + 120) {
        return nil;
    }
    return payload;
}

- (void)validateStoredEntitlement {
    self.licensePayload = [self verifiedPayloadForToken:self.entitlement expectedNonce:nil];
    if (!self.licensePayload) self.entitlement = nil;
}

- (BOOL)isLicenseActive {
    [self validateStoredEntitlement];
    return self.licensePayload != nil;
}

- (NSString *)randomNonce {
    uint8_t bytes[24];
    if (SecRandomCopyBytes(kSecRandomDefault, sizeof(bytes), bytes) != errSecSuccess) {
        return NSUUID.UUID.UUIDString;
    }
    return [[NSData dataWithBytes:bytes length:sizeof(bytes)] base64EncodedStringWithOptions:0];
}

- (NSDictionary *)commonRequestBodyWithNonce:(NSString *)nonce {
    return @{
        @"username": self.username ?: @"",
        @"deviceId": self.deviceId ?: @"",
        @"deviceLabel": UIDevice.currentDevice.name ?: @"iPhone",
        @"model": [self hardwareModel],
        @"iosVersion": UIDevice.currentDevice.systemVersion ?: @"",
        @"clientVersion": SCClientVersion,
        @"nonce": nonce
    };
}

- (void)postPath:(NSString *)path
            body:(NSDictionary *)body
      completion:(void (^)(NSDictionary *response, NSInteger statusCode, NSError *error))completion {
    NSURL *url = [NSURL URLWithString:[SCLicenseBaseURL stringByAppendingString:path]];
    NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:url];
    request.HTTPMethod = @"POST";
    request.timeoutInterval = 18;
    [request setValue:@"application/json" forHTTPHeaderField:@"Content-Type"];
    [request setValue:@"no-store" forHTTPHeaderField:@"Cache-Control"];
    request.HTTPBody = [NSJSONSerialization dataWithJSONObject:body options:0 error:nil];

    NSURLSessionConfiguration *configuration = NSURLSessionConfiguration.ephemeralSessionConfiguration;
    configuration.URLCache = nil;
    configuration.requestCachePolicy = NSURLRequestReloadIgnoringLocalCacheData;
    NSURLSession *session = [NSURLSession sessionWithConfiguration:configuration];
    [[session dataTaskWithRequest:request completionHandler:^(NSData *data,
                                                             NSURLResponse *response,
                                                             NSError *error) {
        NSInteger statusCode = [(NSHTTPURLResponse *)response statusCode];
        NSDictionary *json = data.length
            ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil]
            : nil;
        dispatch_async(dispatch_get_main_queue(), ^{
            completion([json isKindOfClass:NSDictionary.class] ? json : @{}, statusCode, error);
        });
        [session finishTasksAndInvalidate];
    }] resume];
}

- (BOOL)acceptCredentials:(NSDictionary *)response nonce:(NSString *)nonce {
    NSString *entitlement = response[@"entitlement"];
    NSString *refreshToken = response[@"refreshToken"];
    NSDictionary *payload = [self verifiedPayloadForToken:entitlement expectedNonce:nonce];
    if (!payload || refreshToken.length < 32) return NO;

    self.entitlement = entitlement;
    self.refreshToken = refreshToken;
    self.licensePayload = payload;
    [self setKeychainString:self.username forAccount:@"username"];
    [self setKeychainString:self.refreshToken forAccount:@"refresh-token"];
    [self setKeychainString:self.entitlement forAccount:@"entitlement"];
    [self setKeychainString:[payload[@"iat"] stringValue] forAccount:@"anchor-server-time"];
    [self setKeychainString:[NSString stringWithFormat:@"%.3f", NSProcessInfo.processInfo.systemUptime]
                  forAccount:@"anchor-uptime"];
    return YES;
}

- (void)clearSessionKeepingUsername:(BOOL)keepUsername {
    self.refreshToken = nil;
    self.entitlement = nil;
    self.licensePayload = nil;
    [self setKeychainString:nil forAccount:@"refresh-token"];
    [self setKeychainString:nil forAccount:@"entitlement"];
    [self setKeychainString:nil forAccount:@"anchor-server-time"];
    [self setKeychainString:nil forAccount:@"anchor-uptime"];
    if (!keepUsername) {
        self.username = nil;
        [self setKeychainString:nil forAccount:@"username"];
    }
}

- (UIViewController *)presentationController {
    UIViewController *controller = [[SCOverlayManager sharedManager] presentationViewController];
    while (controller.presentedViewController) controller = controller.presentedViewController;
    return controller;
}

- (void)showMessage:(NSString *)message title:(NSString *)title {
    UIViewController *controller = [self presentationController];
    if (!controller) return;
    UIAlertController *alert = [UIAlertController alertControllerWithTitle:title
                                                                   message:message
                                                            preferredStyle:UIAlertControllerStyleAlert];
    [alert addAction:[UIAlertAction actionWithTitle:@"Đóng" style:UIAlertActionStyleCancel handler:nil]];
    [controller presentViewController:alert animated:YES completion:nil];
}

- (void)authorizeCapture:(void (^)(BOOL allowed))completion {
    if ([self isLicenseActive]) {
        if (completion) completion(YES);
        return;
    }
    if (self.requestInFlight) {
        if (completion) completion(NO);
        return;
    }
    if (self.username.length && self.refreshToken.length) {
        [self refreshSilently:NO completion:^(BOOL success) {
            if (success) {
                if (completion) completion(YES);
            } else {
                [self presentLoginWithCompletion:completion];
            }
        }];
        return;
    }
    [self presentLoginWithCompletion:completion];
}

- (void)presentLoginWithCompletion:(void (^)(BOOL allowed))completion {
    UIViewController *controller = [self presentationController];
    if (!controller) {
        if (completion) completion(NO);
        return;
    }
    UIAlertController *alert = [UIAlertController
        alertControllerWithTitle:@"Kích hoạt ScreenClone"
                         message:@"Đăng nhập tài khoản được cấp phép. Thiết bị mới cần được quản trị viên phê duyệt."
                  preferredStyle:UIAlertControllerStyleAlert];
    [alert addTextFieldWithConfigurationHandler:^(UITextField *field) {
        field.placeholder = @"Tên đăng nhập";
        field.text = self.username;
        field.autocapitalizationType = UITextAutocapitalizationTypeNone;
        field.autocorrectionType = UITextAutocorrectionTypeNo;
    }];
    [alert addTextFieldWithConfigurationHandler:^(UITextField *field) {
        field.placeholder = @"Mật khẩu";
        field.secureTextEntry = YES;
        field.textContentType = UITextContentTypePassword;
    }];
    [alert addAction:[UIAlertAction actionWithTitle:@"Hủy"
                                             style:UIAlertActionStyleCancel
                                           handler:^(__unused UIAlertAction *action) {
        if (completion) completion(NO);
    }]];
    [alert addAction:[UIAlertAction actionWithTitle:@"Đăng nhập"
                                             style:UIAlertActionStyleDefault
                                           handler:^(__unused UIAlertAction *action) {
        NSString *username = alert.textFields.firstObject.text.lowercaseString;
        NSString *password = alert.textFields.lastObject.text;
        if (!username.length || !password.length) {
            [self showMessage:@"Vui lòng nhập đầy đủ tên đăng nhập và mật khẩu." title:@"ScreenClone"];
            if (completion) completion(NO);
            return;
        }
        [self loginUsername:username password:password completion:completion];
    }]];
    [controller presentViewController:alert animated:YES completion:nil];
}

- (void)loginUsername:(NSString *)username
              password:(NSString *)password
            completion:(void (^)(BOOL allowed))completion {
    if (self.requestInFlight) {
        if (completion) completion(NO);
        return;
    }
    self.requestInFlight = YES;
    self.username = username.lowercaseString;
    NSString *nonce = [self randomNonce];
    NSMutableDictionary *body = [[self commonRequestBodyWithNonce:nonce] mutableCopy];
    body[@"password"] = password;
    [self postPath:@"/login" body:body completion:^(NSDictionary *response,
                                                    NSInteger statusCode,
                                                    NSError *error) {
        self.requestInFlight = NO;
        if (!error && statusCode == 200 && [self acceptCredentials:response nonce:nonce]) {
            if (completion) completion(YES);
            return;
        }
        [self clearSessionKeepingUsername:YES];
        [self setKeychainString:self.username forAccount:@"username"];
        NSString *message = response[@"error"] ?: (error ? @"Không thể kết nối máy chủ bản quyền." : @"Phản hồi bản quyền không hợp lệ.");
        [self showMessage:message title:@"Không thể kích hoạt"];
        if (completion) completion(NO);
    }];
}

- (void)refreshSilently:(BOOL)silent completion:(void (^)(BOOL success))completion {
    if (self.requestInFlight || !self.username.length || !self.refreshToken.length) {
        if (completion) completion(NO);
        return;
    }
    self.requestInFlight = YES;
    NSString *nonce = [self randomNonce];
    NSMutableDictionary *body = [[self commonRequestBodyWithNonce:nonce] mutableCopy];
    body[@"refreshToken"] = self.refreshToken;
    [self postPath:@"/refresh" body:body completion:^(NSDictionary *response,
                                                      NSInteger statusCode,
                                                      NSError *error) {
        self.requestInFlight = NO;
        if (!error && statusCode == 200 && [self acceptCredentials:response nonce:nonce]) {
            if (completion) completion(YES);
            return;
        }
        NSString *code = response[@"code"];
        if ([code isEqualToString:@"license_revoked"] ||
            [code isEqualToString:@"invalid_session"] ||
            [code isEqualToString:@"replayed_session"] ||
            [code isEqualToString:@"upgrade_required"]) {
            [self clearSessionKeepingUsername:YES];
        } else {
            [self validateStoredEntitlement];
        }
        if (!silent && ![self isLicenseActive]) {
            NSString *message = response[@"error"] ?: @"Không thể kiểm tra giấy phép. Hãy kiểm tra kết nối mạng.";
            [self showMessage:message title:@"ScreenClone"];
        }
        if (completion) completion([self isLicenseActive]);
    }];
}

- (void)presentAccountPanel {
    if (!self.username.length) {
        [self presentLoginWithCompletion:nil];
        return;
    }
    UIViewController *controller = [self presentationController];
    if (!controller) return;
    BOOL active = [self isLicenseActive];
    NSTimeInterval expiry = [self.licensePayload[@"exp"] doubleValue];
    NSString *expiryText = expiry > 0
        ? [NSDateFormatter localizedStringFromDate:[NSDate dateWithTimeIntervalSince1970:expiry]
                                         dateStyle:NSDateFormatterShortStyle
                                         timeStyle:NSDateFormatterShortStyle]
        : @"Chưa có";
    NSString *message = [NSString stringWithFormat:@"Tài khoản: %@\nTrạng thái: %@\nPhiên offline đến: %@\nMã máy: %@…",
                         self.username,
                         active ? @"Đang hoạt động" : @"Cần xác thực",
                         expiryText,
                         [self.deviceId substringToIndex:MIN((NSUInteger)12, self.deviceId.length)]];
    UIAlertController *alert = [UIAlertController alertControllerWithTitle:@"Tài khoản ScreenClone"
                                                                   message:message
                                                            preferredStyle:UIAlertControllerStyleActionSheet];
    [alert addAction:[UIAlertAction actionWithTitle:@"Kiểm tra lại giấy phép"
                                             style:UIAlertActionStyleDefault
                                           handler:^(__unused UIAlertAction *action) {
        [self refreshSilently:NO completion:^(BOOL success) {
            if (success) [self showMessage:@"Giấy phép đang hoạt động." title:@"ScreenClone"];
        }];
    }]];
    [alert addAction:[UIAlertAction actionWithTitle:@"Đăng xuất"
                                             style:UIAlertActionStyleDestructive
                                           handler:^(__unused UIAlertAction *action) {
        [self clearSessionKeepingUsername:NO];
        [self showMessage:@"Đã xóa phiên đăng nhập trên thiết bị." title:@"ScreenClone"];
    }]];
    [alert addAction:[UIAlertAction actionWithTitle:@"Đóng" style:UIAlertActionStyleCancel handler:nil]];
    alert.popoverPresentationController.sourceView = controller.view;
    alert.popoverPresentationController.sourceRect = CGRectMake(CGRectGetMidX(controller.view.bounds),
                                                                 CGRectGetMidY(controller.view.bounds), 1, 1);
    [controller presentViewController:alert animated:YES completion:nil];
}

@end
