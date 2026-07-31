#import "SCOverlayManager.h"
#import <QuartzCore/QuartzCore.h>
#import <dlfcn.h>
#import <objc/message.h>

typedef CGImageRef (*SCGetScreenImageFunction)(void);
typedef UIImage *(*SCCreateScreenUIImageFunction)(void);

@interface SCPassthroughWindow : UIWindow
@property (nonatomic, assign) BOOL selecting;
@end

@implementation SCPassthroughWindow
- (UIView *)hitTest:(CGPoint)point withEvent:(UIEvent *)event {
    if (self.selecting || self.rootViewController.presentedViewController) {
        return [super hitTest:point withEvent:event];
    }
    if (point.y >= CGRectGetHeight(self.bounds) - 110) {
        return nil;
    }
    UIView *rootView = self.rootViewController.view;
    for (UIView *view in rootView.subviews.reverseObjectEnumerator) {
        if (view.tag == 7303 && !view.hidden && view.alpha > 0.01 &&
            CGRectContainsPoint(view.frame, point)) {
            return view;
        }
    }
    return nil;
}
@end

@interface SCOverlayManager () <UIGestureRecognizerDelegate>
@property (nonatomic, strong) SCPassthroughWindow *window;
@property (nonatomic, strong) UIView *rootView;
@property (nonatomic, strong) UIView *selectionView;
@property (nonatomic, strong) NSMutableArray<UIView *> *cropHandles;
@property (nonatomic, strong) UIButton *confirmCropButton;
@property (nonatomic, strong) UIButton *cancelCropButton;
@property (nonatomic, strong) NSMutableArray<UIImageView *> *clones;
@property (nonatomic, strong) UIImage *screenImage;
@property (nonatomic, assign) CGPoint dragStart;
@property (nonatomic, assign) CGRect cropGestureStartFrame;
@property (nonatomic, assign) BOOL clonesVisible;
@property (nonatomic, assign) BOOL started;
@property (nonatomic, assign) BOOL capturePending;
@end

@implementation SCOverlayManager

static void SCLog(NSString *message) {
    NSString *line = [NSString stringWithFormat:@"%@ %@\n", [NSDate date], message];
    NSFileHandle *handle = [NSFileHandle fileHandleForWritingAtPath:@"/var/mobile/ScreenClone.log"];
    if (!handle) {
        [line writeToFile:@"/var/mobile/ScreenClone.log"
               atomically:YES
                 encoding:NSUTF8StringEncoding
                    error:nil];
        return;
    }
    [handle seekToEndOfFile];
    [handle writeData:[line dataUsingEncoding:NSUTF8StringEncoding]];
    [handle closeFile];
}

static void SCZoneNotification(CFNotificationCenterRef center,
                               void *observer,
                               CFStringRef name,
                               const void *object,
                               CFDictionaryRef userInfo) {
    BOOL visible = CFEqual(name, CFSTR("com.quanhandsome.screenclone.zone.show"));
    dispatch_async(dispatch_get_main_queue(), ^{
        [[SCOverlayManager sharedManager] applyClonesVisible:visible];
    });
}

+ (instancetype)sharedManager {
    static SCOverlayManager *manager;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        manager = [SCOverlayManager new];
    });
    return manager;
}

- (void)start {
    if (self.started) return;
    self.started = YES;
    self.clones = [NSMutableArray array];
    self.clonesVisible = YES;

    CGRect bounds = UIScreen.mainScreen.bounds;
    self.window = [[SCPassthroughWindow alloc] initWithFrame:bounds];
    self.window.windowLevel = UIWindowLevelAlert + 1000.0;
    self.window.backgroundColor = UIColor.clearColor;
    UIViewController *controller = [UIViewController new];
    controller.view.backgroundColor = UIColor.clearColor;
    self.rootView = controller.view;
    self.window.rootViewController = controller;

    self.window.hidden = NO;
    CFNotificationCenterAddObserver(CFNotificationCenterGetDarwinNotifyCenter(),
                                    NULL,
                                    SCZoneNotification,
                                    CFSTR("com.quanhandsome.screenclone.zone.show"),
                                    NULL,
                                    CFNotificationSuspensionBehaviorDeliverImmediately);
    CFNotificationCenterAddObserver(CFNotificationCenterGetDarwinNotifyCenter(),
                                    NULL,
                                    SCZoneNotification,
                                    CFSTR("com.quanhandsome.screenclone.zone.hide"),
                                    NULL,
                                    CFNotificationSuspensionBehaviorDeliverImmediately);
    SCLog(@"manager started");
}

- (void)applyClonesVisible:(BOOL)visible {
    self.clonesVisible = visible;
    for (UIImageView *clone in self.clones) {
        clone.hidden = !visible;
    }
}

- (void)activateCapture {
    SCLog(@"activateCapture called");
    if (self.window.selecting || self.capturePending) return;
    [self beginSelection];
}

- (UIImage *)captureScreen {
    id springBoard = UIApplication.sharedApplication;
    SEL managerSelector = NSSelectorFromString(@"screenshotManager");
    if ([springBoard respondsToSelector:managerSelector]) {
        id screenshotManager = ((id (*)(id, SEL))objc_msgSend)(springBoard, managerSelector);
        SEL providerSelector = NSSelectorFromString(@"_providerForScreen:");
        if ([screenshotManager respondsToSelector:providerSelector]) {
            id provider = ((id (*)(id, SEL, id))objc_msgSend)(
                screenshotManager, providerSelector, UIScreen.mainScreen);
            SEL captureSelector = NSSelectorFromString(@"captureScreenshot");
            if ([provider respondsToSelector:captureSelector]) {
                id result = ((id (*)(id, SEL))objc_msgSend)(provider, captureSelector);
                SCLog([NSString stringWithFormat:@"system provider=%@ result=%@",
                       provider, result]);
                if ([result isKindOfClass:UIImage.class]) return result;
                SEL imageSelector = NSSelectorFromString(@"image");
                if ([result respondsToSelector:imageSelector]) {
                    id image = ((id (*)(id, SEL))objc_msgSend)(result, imageSelector);
                    if ([image isKindOfClass:UIImage.class]) return image;
                }
            }
        }
    }

    Class snapshotterClass = NSClassFromString(@"SSMainScreenSnapshotter");
    SEL initSelector = NSSelectorFromString(@"initWithScreen:");
    id snapshotter = ((id (*)(id, SEL, id))objc_msgSend)(
        [snapshotterClass alloc], initSelector, UIScreen.mainScreen);
    SEL takeSelector = NSSelectorFromString(@"takeScreenshot");
    if ([snapshotter respondsToSelector:takeSelector]) {
        id result = ((id (*)(id, SEL))objc_msgSend)(snapshotter, takeSelector);
        SCLog([NSString stringWithFormat:@"snapshotter result=%@", result]);
        if ([result isKindOfClass:UIImage.class]) return result;
    }

    SCCreateScreenUIImageFunction createScreenUIImage =
        (SCCreateScreenUIImageFunction)dlsym(RTLD_DEFAULT, "_UICreateScreenUIImage");
    SCLog([NSString stringWithFormat:@"_UICreateScreenUIImage=%p", createScreenUIImage]);
    if (createScreenUIImage) {
        UIImage *image = createScreenUIImage();
        SCLog([NSString stringWithFormat:@"created UIImage=%@ size=%@",
              image, NSStringFromCGSize(image.size)]);
        if (image) return image;
    }

    SCGetScreenImageFunction getScreenImage =
        (SCGetScreenImageFunction)dlsym(RTLD_DEFAULT, "UIGetScreenImage");
    SCLog([NSString stringWithFormat:@"UIGetScreenImage=%p", getScreenImage]);
    if (!getScreenImage) return nil;
    CGImageRef imageRef = getScreenImage();
    if (!imageRef) return nil;
    UIImage *image = [UIImage imageWithCGImage:imageRef
                                         scale:UIScreen.mainScreen.scale
                                   orientation:UIImageOrientationUp];
    CGImageRelease(imageRef);
    return image;
}

- (void)beginSelection {
    SCLog(@"beginSelection");
    self.capturePending = YES;
    self.window.hidden = YES;
    [CATransaction flush];
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 100 * NSEC_PER_MSEC),
                   dispatch_get_main_queue(), ^{
        [self finishBeginningSelection];
    });
}

- (void)finishBeginningSelection {
    self.screenImage = [self captureScreen];
    self.window.hidden = NO;
    self.capturePending = NO;
    if (!self.screenImage) {
        SCLog(@"capture failed: image is nil");
        return;
    }

    self.window.selecting = YES;
    SCLog(@"selection active");
    self.rootView.backgroundColor = [UIColor colorWithWhite:0 alpha:0.08];
    UIImpactFeedbackGenerator *feedback =
        [[UIImpactFeedbackGenerator alloc] initWithStyle:UIImpactFeedbackStyleMedium];
    [feedback impactOccurred];
    self.clonesVisible = YES;
    for (UIImageView *clone in self.clones) clone.hidden = NO;

    UIPanGestureRecognizer *pan = [[UIPanGestureRecognizer alloc]
        initWithTarget:self action:@selector(selectionPanned:)];
    [self.rootView addGestureRecognizer:pan];
}

- (void)selectionPanned:(UIPanGestureRecognizer *)gesture {
    CGPoint point = [gesture locationInView:self.rootView];
    if (gesture.state == UIGestureRecognizerStateBegan) {
        SCLog(@"selection pan began");
        self.dragStart = point;
        self.selectionView = [[UIView alloc] initWithFrame:CGRectMake(point.x, point.y, 1, 1)];
        self.selectionView.backgroundColor = [UIColor colorWithWhite:1 alpha:0.12];
        self.selectionView.layer.borderColor = UIColor.whiteColor.CGColor;
        self.selectionView.layer.borderWidth = 1.0;
        [self.rootView addSubview:self.selectionView];
    } else if (gesture.state == UIGestureRecognizerStateChanged) {
        self.selectionView.frame = [self normalizedRectFrom:self.dragStart to:point];
    } else if (gesture.state == UIGestureRecognizerStateEnded) {
        SCLog(@"selection pan ended");
        CGRect rect = self.selectionView.frame;
        [self.rootView removeGestureRecognizer:gesture];
        if (rect.size.width >= 20 && rect.size.height >= 20) {
            [self beginCropEditing];
        } else {
            [self cancelCrop];
        }
    } else if (gesture.state == UIGestureRecognizerStateCancelled ||
               gesture.state == UIGestureRecognizerStateFailed) {
        [self.rootView removeGestureRecognizer:gesture];
        [self cancelCrop];
    }
}

- (CGRect)normalizedRectFrom:(CGPoint)a to:(CGPoint)b {
    return CGRectMake(MIN(a.x, b.x), MIN(a.y, b.y),
                      fabs(b.x - a.x), fabs(b.y - a.y));
}

- (void)beginCropEditing {
    self.selectionView.backgroundColor = [UIColor colorWithWhite:1 alpha:0.06];
    self.selectionView.layer.borderColor = [UIColor colorWithRed:0.15 green:0.65 blue:1 alpha:1].CGColor;
    self.selectionView.layer.borderWidth = 2.0;
    self.selectionView.userInteractionEnabled = YES;
    [self.selectionView addGestureRecognizer:[[UIPanGestureRecognizer alloc]
        initWithTarget:self action:@selector(cropMoved:)]];

    self.cropHandles = [NSMutableArray array];
    for (NSInteger index = 0; index < 4; index++) {
        UIView *handle = [[UIView alloc] initWithFrame:CGRectMake(0, 0, 26, 26)];
        handle.tag = index;
        handle.backgroundColor = UIColor.whiteColor;
        handle.layer.cornerRadius = 13;
        handle.layer.borderWidth = 2;
        handle.layer.borderColor = [UIColor colorWithRed:0.15 green:0.65 blue:1 alpha:1].CGColor;
        [handle addGestureRecognizer:[[UIPanGestureRecognizer alloc]
            initWithTarget:self action:@selector(cropHandlePanned:)]];
        [self.rootView addSubview:handle];
        [self.cropHandles addObject:handle];
    }

    self.confirmCropButton = [self cropButtonWithTitle:@"Xong"
                                                 color:[UIColor colorWithRed:0.10 green:0.55 blue:0.95 alpha:1]
                                                action:@selector(confirmCrop)];
    self.cancelCropButton = [self cropButtonWithTitle:@"Hủy"
                                                color:[UIColor colorWithWhite:0.22 alpha:0.95]
                                               action:@selector(cancelCrop)];
    [self updateCropControls];
}

- (UIButton *)cropButtonWithTitle:(NSString *)title
                            color:(UIColor *)color
                           action:(SEL)action {
    UIButton *button = [UIButton buttonWithType:UIButtonTypeSystem];
    button.frame = CGRectMake(0, 0, 68, 36);
    button.backgroundColor = color;
    button.layer.cornerRadius = 9;
    [button setTitle:title forState:UIControlStateNormal];
    [button setTitleColor:UIColor.whiteColor forState:UIControlStateNormal];
    button.titleLabel.font = [UIFont boldSystemFontOfSize:15];
    [button addTarget:self action:action forControlEvents:UIControlEventTouchUpInside];
    [self.rootView addSubview:button];
    return button;
}

- (void)updateCropControls {
    CGRect frame = self.selectionView.frame;
    NSArray<NSValue *> *points = @[
        [NSValue valueWithCGPoint:CGPointMake(CGRectGetMinX(frame), CGRectGetMinY(frame))],
        [NSValue valueWithCGPoint:CGPointMake(CGRectGetMaxX(frame), CGRectGetMinY(frame))],
        [NSValue valueWithCGPoint:CGPointMake(CGRectGetMinX(frame), CGRectGetMaxY(frame))],
        [NSValue valueWithCGPoint:CGPointMake(CGRectGetMaxX(frame), CGRectGetMaxY(frame))]
    ];
    [self.cropHandles enumerateObjectsUsingBlock:^(UIView *handle, NSUInteger index, BOOL *stop) {
        handle.center = points[index].CGPointValue;
    }];

    CGFloat controlsY = CGRectGetMaxY(frame) + 12;
    if (controlsY + 36 > CGRectGetHeight(self.rootView.bounds)) {
        controlsY = CGRectGetMinY(frame) - 48;
    }
    controlsY = MAX(8, controlsY);
    CGFloat startX = MIN(MAX(8, CGRectGetMidX(frame) - 73), CGRectGetWidth(self.rootView.bounds) - 154);
    self.cancelCropButton.frame = CGRectMake(startX, controlsY, 68, 36);
    self.confirmCropButton.frame = CGRectMake(startX + 78, controlsY, 68, 36);
}

- (void)cropMoved:(UIPanGestureRecognizer *)gesture {
    if (gesture.state == UIGestureRecognizerStateBegan) {
        self.cropGestureStartFrame = self.selectionView.frame;
    }
    CGPoint translation = [gesture translationInView:self.rootView];
    CGRect frame = self.cropGestureStartFrame;
    frame.origin.x += translation.x;
    frame.origin.y += translation.y;
    CGRect bounds = self.rootView.bounds;
    frame.origin.x = MIN(MAX(CGRectGetMinX(bounds), frame.origin.x), CGRectGetMaxX(bounds) - frame.size.width);
    frame.origin.y = MIN(MAX(CGRectGetMinY(bounds), frame.origin.y), CGRectGetMaxY(bounds) - frame.size.height);
    self.selectionView.frame = frame;
    [self updateCropControls];
}

- (void)cropHandlePanned:(UIPanGestureRecognizer *)gesture {
    if (gesture.state == UIGestureRecognizerStateBegan) {
        self.cropGestureStartFrame = self.selectionView.frame;
    }
    CGPoint delta = [gesture translationInView:self.rootView];
    CGRect start = self.cropGestureStartFrame;
    CGFloat left = CGRectGetMinX(start);
    CGFloat right = CGRectGetMaxX(start);
    CGFloat top = CGRectGetMinY(start);
    CGFloat bottom = CGRectGetMaxY(start);
    NSInteger corner = gesture.view.tag;
    if (corner == 0 || corner == 2) left += delta.x; else right += delta.x;
    if (corner == 0 || corner == 1) top += delta.y; else bottom += delta.y;

    CGRect bounds = self.rootView.bounds;
    left = MAX(CGRectGetMinX(bounds), MIN(left, right - 32));
    right = MIN(CGRectGetMaxX(bounds), MAX(right, left + 32));
    top = MAX(CGRectGetMinY(bounds), MIN(top, bottom - 32));
    bottom = MIN(CGRectGetMaxY(bounds), MAX(bottom, top + 32));
    self.selectionView.frame = CGRectMake(left, top, right - left, bottom - top);
    [self updateCropControls];
}

- (void)confirmCrop {
    CGRect rect = self.selectionView.frame;
    [self removeCropControls];
    self.window.selecting = NO;
    self.rootView.backgroundColor = UIColor.clearColor;
    [self addCloneForRect:rect];
    self.screenImage = nil;
}

- (void)cancelCrop {
    [self removeCropControls];
    self.window.selecting = NO;
    self.rootView.backgroundColor = UIColor.clearColor;
    self.screenImage = nil;
}

- (void)removeCropControls {
    [self.selectionView removeFromSuperview];
    self.selectionView = nil;
    for (UIView *handle in self.cropHandles) [handle removeFromSuperview];
    [self.cropHandles removeAllObjects];
    self.cropHandles = nil;
    [self.confirmCropButton removeFromSuperview];
    [self.cancelCropButton removeFromSuperview];
    self.confirmCropButton = nil;
    self.cancelCropButton = nil;
}

- (void)addCloneForRect:(CGRect)rect {
    CGFloat scale = self.screenImage.scale;
    CGRect pixelRect = CGRectMake(rect.origin.x * scale,
                                  rect.origin.y * scale,
                                  rect.size.width * scale,
                                  rect.size.height * scale);
    pixelRect = CGRectIntersection(pixelRect,
                                   CGRectMake(0, 0,
                                              CGImageGetWidth(self.screenImage.CGImage),
                                              CGImageGetHeight(self.screenImage.CGImage)));
    if (CGRectIsEmpty(pixelRect)) return;

    CGImageRef croppedRef = CGImageCreateWithImageInRect(self.screenImage.CGImage, pixelRect);
    if (!croppedRef) return;
    UIImage *cropped = [UIImage imageWithCGImage:croppedRef
                                           scale:scale
                                     orientation:UIImageOrientationUp];
    CGImageRelease(croppedRef);

    // System screenshots can be backed by a protected IOSurface. A sub-image
    // keeps that backing store and Core Animation renders it black when it is
    // placed back on screen. PNG round-tripping creates an independent bitmap.
    NSData *bitmapData = UIImagePNGRepresentation(cropped);
    UIImage *displayImage = bitmapData
        ? [UIImage imageWithData:bitmapData scale:scale]
        : cropped;

    UIImageView *clone = [[UIImageView alloc] initWithFrame:rect];
    clone.tag = 7303;
    clone.image = displayImage;
    clone.contentMode = UIViewContentModeScaleToFill;
    clone.userInteractionEnabled = YES;
    clone.layer.borderWidth = 0;
    clone.layer.cornerRadius = 0;
    clone.clipsToBounds = YES;
    clone.hidden = !self.clonesVisible;
    UITapGestureRecognizer *tap = [[UITapGestureRecognizer alloc]
        initWithTarget:self action:@selector(cloneTapped:)];
    [clone addGestureRecognizer:tap];
    [self.rootView addSubview:clone];
    [self.clones addObject:clone];
}

- (void)cloneTapped:(UITapGestureRecognizer *)gesture {
    if (gesture.state != UIGestureRecognizerStateEnded) return;
    UIImageView *clone = (UIImageView *)gesture.view;
    if (![clone isKindOfClass:UIImageView.class]) return;

    UIAlertController *menu = [UIAlertController
        alertControllerWithTitle:@"Ảnh clone"
                         message:nil
                  preferredStyle:UIAlertControllerStyleActionSheet];
    [menu addAction:[UIAlertAction actionWithTitle:@"Sao chép"
                                             style:UIAlertActionStyleDefault
                                           handler:^(__unused UIAlertAction *action) {
        UIPasteboard.generalPasteboard.image = clone.image;
    }]];
    [menu addAction:[UIAlertAction actionWithTitle:@"Chia sẻ"
                                             style:UIAlertActionStyleDefault
                                           handler:^(__unused UIAlertAction *action) {
        UIActivityViewController *share = [[UIActivityViewController alloc]
            initWithActivityItems:@[clone.image]
            applicationActivities:nil];
        share.popoverPresentationController.sourceView = clone;
        share.popoverPresentationController.sourceRect = clone.bounds;
        [self.window.rootViewController presentViewController:share
                                                     animated:YES
                                                   completion:nil];
    }]];
    [menu addAction:[UIAlertAction actionWithTitle:@"Xóa ảnh"
                                             style:UIAlertActionStyleDestructive
                                           handler:^(__unused UIAlertAction *action) {
        [self.clones removeObject:clone];
        [clone removeFromSuperview];
    }]];
    [menu addAction:[UIAlertAction actionWithTitle:@"Hủy"
                                             style:UIAlertActionStyleCancel
                                           handler:nil]];
    menu.popoverPresentationController.sourceView = clone;
    menu.popoverPresentationController.sourceRect = clone.bounds;
    [self.window.rootViewController presentViewController:menu
                                                 animated:YES
                                               completion:nil];
}

@end
