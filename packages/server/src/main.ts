import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { RealtimeService } from './realtime/realtime.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 全局前缀
  app.setGlobalPrefix('api');

  // 全局验证管道
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // CORS
  app.enableCors();

  // Swagger 文档配置
  const config = new DocumentBuilder()
    .setTitle('欢乐记分馆 API')
    .setDescription('欢乐记分馆微信小程序后端 API 文档')
    .setVersion('1.0.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: '输入 JWT Token',
      },
      'JWT-auth',
    )
    .addTag('认证', '微信登录相关接口')
    .addTag('用户', '用户信息相关接口')
    .addTag('游客', '游客身份相关接口')
    .addTag('房间', '多人记分房间相关接口')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api-docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
    },
    customSiteTitle: '欢乐记分馆 API 文档',
  });

  const port = process.env.PORT || 3000;
  const realtimeService = app.get(RealtimeService);
  realtimeService.bindServer(app.getHttpServer());

  await app.listen(port, '0.0.0.0');
  console.log(`🎮 欢乐记分馆 API 服务已启动: http://0.0.0.0:${port}`);
  console.log(`📖 Swagger 文档: http://0.0.0.0:${port}/api-docs`);
  console.log(`🔄 Realtime WebSocket: ws://0.0.0.0:${port}/ws`);
}
bootstrap();
